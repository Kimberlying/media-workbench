import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { LlmGateway } from "@/lib/llm";
import { addDays } from "@/lib/dates";
import type { Step } from "@/lib/llm/models";
import { FEEDS, httpFetchText, type FeedItem, type FetchText } from "@/lib/radar/feeds";
import { classify, dedupe, URL_WINDOW_DAYS, type SeenItem } from "@/lib/radar/filters";

// 资讯雷达，两路来源入同一个共享池：
// 1. Grok 按所有账号档案关心的方向，实时搜 X 上过去 24 小时的热点（kim 2026-10-13 决定不要 Gemini 全网动态）
// 2. 固定信源（Product Hunt、HN、GitHub Trending 等，见 src/lib/radar/feeds.ts），不经过模型
// 入库前统一去重，并打上「利他」「清醒」分类标签。
// 对标账号视频转录（VideoScript）不在一期骨架里，接入后在这里加一个来源即可。

const NewsBatch = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        url: z.url(),
        summary: z.string(),
        tags: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export type NewsBatch = z.infer<typeof NewsBatch>;

const SOURCES: { step: Step; source: string; instruction: string }[] = [
  {
    step: "radar.x",
    source: "x",
    instruction: "用 X 搜索找过去 24 小时与这些方向相关、讨论度最高的话题和帖子。url 填帖子的链接。",
  },
];

/** Grok 的 X 搜索工具，限定在昨天到今天（UTC，to_date 不含当天） */
export function xSearchTool(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return { type: "x_search", from_date: addDays(today, -1), to_date: addDays(today, 1) };
}

export async function collectInterests(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db.from("account_profiles").select("positioning, benchmarks");
  if (error) throw new Error(error.message);
  const interests = new Set<string>();
  for (const row of data ?? []) {
    if (row.positioning) interests.add(row.positioning);
    for (const b of row.benchmarks ?? []) interests.add(b);
  }
  return [...interests];
}

export async function fetchNews(
  llm: LlmGateway,
  interests: string[],
  source: (typeof SOURCES)[number],
): Promise<NewsBatch["items"]> {
  const batch = await llm.generate({
    orgId: null, // 共享池抓取不计入任何租户
    step: source.step,
    json: NewsBatch,
    temperature: 0.2,
    tools: source.source === "x" ? [xSearchTool()] : undefined,
    messages: [
      {
        role: "system",
        content:
          "你是资讯雷达。只返回 JSON：{\"items\":[{\"title\",\"url\",\"summary\",\"tags\"}]}。" +
          "summary 用中文，不超过 80 字；tags 3–5 个中文短词；url 必须是原始链接。最多 15 条。",
      },
      {
        role: "user",
        content: `${source.instruction}\n关注方向：\n- ${interests.join("\n- ")}`,
      },
    ],
  });
  return batch.items;
}

export type RadarItem = FeedItem & { tags?: string[] };

/** 抓全部固定信源；单个信源失败不影响其他 */
export async function fetchFeeds(fetchText: FetchText = httpFetchText): Promise<FeedItem[]> {
  const results = await Promise.allSettled(FEEDS.map((feed) => feed.fetch(fetchText)));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** Grok 搜到的条目没有热度分，记 0 */
export function fromGrok(source: string, items: NewsBatch["items"]): RadarItem[] {
  return items.map((i) => ({ source, heat: 0, ...i }));
}

export async function saveNews(db: SupabaseClient, items: RadarItem[], now = new Date()): Promise<number> {
  if (items.length === 0) return 0;
  const since = new Date(now.getTime() - URL_WINDOW_DAYS * 86400_000).toISOString();
  const { data: seen, error: seenError } = await db
    .from("news_items")
    .select("title, url, summary, fetched_at")
    .gte("fetched_at", since);
  if (seenError) throw new Error(seenError.message);

  const fresh = dedupe(items, (seen ?? []) as SeenItem[], now) as RadarItem[];
  if (fresh.length === 0) return 0;

  const { data, error } = await db
    .from("news_items")
    .upsert(
      fresh.map((i) => ({
        source: i.source,
        title: i.title,
        url: i.url,
        summary: i.summary,
        heat: i.heat,
        tags: [...new Set([...classify(i), ...(i.tags ?? [])])],
      })),
      { onConflict: "url", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export { SOURCES as RADAR_SOURCES };
