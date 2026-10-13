import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTabooWords } from "@/lib/content/compliance";
import { getFormat, variantOf } from "@/lib/content/formats";
import { rewriteMaterial } from "@/lib/content/x-post";
import type { Account, AccountProfile, NewsItem } from "@/lib/db/types";
import type { LlmGateway } from "@/lib/llm";
import { buildDigest, dayRange, materialOf, pickDaily, type Digest, type DigestPost } from "@/lib/radar/daily";
import type { ContentPack } from "@/lib/xhs/schema";
import { loadKnowledge } from "./copywriting";

// 每天资讯入库后：给每个 X 账号挑 3 条资讯写成短推草稿（只生成，不发布），再汇总成日报。

async function newsOfDay(db: SupabaseClient, day: string): Promise<NewsItem[]> {
  const [from, to] = dayRange(day);
  const { data, error } = await db
    .from("news_items")
    .select("*")
    .gte("fetched_at", from)
    .lt("fetched_at", to)
    .order("heat", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as NewsItem[];
}

interface PostRow {
  body: string;
  pack: ContentPack | null;
  accounts: { handle: string } | null;
}

async function postsOfDay(db: SupabaseClient, day: string, news: NewsItem[]): Promise<DigestPost[]> {
  const [from, to] = dayRange(day);
  const { data, error } = await db
    .from("contents")
    .select("body, pack, accounts(handle)")
    .gte("created_at", from)
    .lt("created_at", to)
    .eq("pack->>mode", "news")
    .order("created_at");
  if (error) throw new Error(error.message);
  const byId = new Map(news.map((n) => [n.id, n]));
  return ((data ?? []) as unknown as PostRow[]).flatMap((row) => {
    const n = row.pack?.kind === "post" && row.pack.newsId ? byId.get(row.pack.newsId) : undefined;
    return n ? [{ handle: row.accounts?.handle ?? "", body: row.body, news: n }] : [];
  });
}

/** 给每个有档案的 X 账号写当天的 3 条短推草稿；当天已经写过的账号跳过（重试不重复写） */
export async function writeDailyPosts(db: SupabaseClient, llm: LlmGateway, day: string): Promise<number> {
  const news = await newsOfDay(db, day);
  if (news.length === 0) return 0;

  const { data: accounts, error } = await db
    .from("accounts")
    .select("*, account_profiles(*)")
    .eq("platform", "x")
    .not("profile_id", "is", null);
  if (error) throw new Error(error.message);

  const done = new Set((await postsOfDay(db, day, news)).map((p) => p.handle));
  let written = 0;
  for (const row of (accounts ?? []) as (Account & { account_profiles: AccountProfile | null })[]) {
    const profile = row.account_profiles;
    if (!profile || done.has(row.handle)) continue;
    const knowledge = await loadKnowledge(db, row.workspace_id);

    for (const n of pickDaily(news)) {
      const { body, pack } = await rewriteMaterial(llm, {
        orgId: row.org_id,
        handle: row.handle,
        tone: profile.tone,
        mode: "news",
        material: materialOf(n),
        newsId: n.id,
      });
      const compliance = checkTabooWords(body, [...profile.taboo, ...knowledge.tabooWords]);
      const { error: insertError } = await db.from("contents").insert({
        org_id: row.org_id,
        account_id: row.id,
        variant: variantOf(getFormat("x.post"), profile.language),
        body,
        pack,
        status: "draft",
        compliance_hits: compliance.hits,
      });
      if (insertError) throw new Error(insertError.message);
      written++;
    }
  }
  return written;
}

export async function loadDigest(db: SupabaseClient, day: string): Promise<{ digest: Digest; posts: DigestPost[] }> {
  const news = await newsOfDay(db, day);
  const posts = await postsOfDay(db, day, news);
  return { digest: buildDigest(day, news, posts), posts };
}
