import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Account, AccountProfile, NewsItem } from "@/lib/db/types";
import type { LlmGateway } from "@/lib/llm";

// 选题策划：按账号档案从资讯库筛选，生成带热度与相关性评分的候选选题。

const TopicBatch = z.object({
  topics: z
    .array(
      z.object({
        title: z.string(),
        angle: z.string(),
        news_ids: z.array(z.string()).default([]),
        heat_score: z.number().int().min(0).max(100),
        relevance_score: z.number().int().min(0).max(100),
      }),
    )
    .default([]),
});

export type PlannedTopic = z.infer<typeof TopicBatch>["topics"][number];

export function buildTopicPrompt(profile: AccountProfile, news: NewsItem[], count: number) {
  const newsList = news
    .map((n) => `[${n.id}] ${n.title}｜${n.summary}｜来源：${n.source}${n.heat ? `（热度 ${n.heat}）` : ""}｜标签：${n.tags.join("、")}`)
    .join("\n");
  return [
    {
      role: "system" as const,
      content:
        "你是内容策划。根据账号档案，从资讯里挑出值得做的选题。只返回 JSON：" +
        "{\"topics\":[{\"title\",\"angle\",\"news_ids\",\"heat_score\",\"relevance_score\"}]}。" +
        "heat_score 是话题热度，relevance_score 是与账号定位的契合度，都是 0–100 的整数。" +
        "news_ids 只能用资讯前方括号里的 id。",
    },
    {
      role: "user" as const,
      content:
        `账号定位：${profile.positioning}\n目标受众：${profile.audience}\n语气：${profile.tone}\n` +
        `不碰的话题：${profile.taboo.join("、") || "无"}\n\n` +
        `给出 ${count} 个选题。资讯：\n${newsList}`,
    },
  ];
}

export async function planTopicsForAccount(
  db: SupabaseClient,
  llm: LlmGateway,
  account: Account,
  profile: AccountProfile,
  { count = 8, sinceHours = 48 } = {},
): Promise<number> {
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const { data: news, error } = await db
    .from("news_items")
    .select("*")
    .gte("fetched_at", since)
    .order("fetched_at", { ascending: false })
    .limit(80);
  if (error) throw new Error(error.message);
  if (!news || news.length === 0) return 0;

  const known = new Set(news.map((n) => n.id));
  const batch = await llm.generate({
    orgId: account.org_id,
    step: "topics.plan",
    json: TopicBatch,
    refId: account.id,
    messages: buildTopicPrompt(profile, news as NewsItem[], count),
  });

  const rows = batch.topics.map((t) => ({
    org_id: account.org_id,
    account_id: account.id,
    title: t.title,
    angle: t.angle,
    news_ids: t.news_ids.filter((id) => known.has(id)),
    heat_score: t.heat_score,
    relevance_score: t.relevance_score,
    status: "candidate",
  }));
  if (rows.length === 0) return 0;

  const { error: insertError } = await db.from("topics").insert(rows);
  if (insertError) throw new Error(insertError.message);
  return rows.length;
}
