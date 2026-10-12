import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { LlmGateway } from "@/lib/llm";
import type { Step } from "@/lib/llm/models";

// 资讯雷达：按所有账号档案关心的方向，抓 X 热点和全网动态，统一入共享池。
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
    instruction: "搜索 X 上过去 24 小时与这些方向相关、讨论度最高的话题和帖子。",
  },
  {
    step: "radar.web",
    source: "web",
    instruction: "搜索全网过去 24 小时与这些方向相关的新闻、产品发布和行业动态。",
  },
];

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

export async function saveNews(
  db: SupabaseClient,
  source: string,
  items: NewsBatch["items"],
): Promise<number> {
  if (items.length === 0) return 0;
  const { data, error } = await db
    .from("news_items")
    .upsert(
      items.map((i) => ({ source, ...i })),
      { onConflict: "url", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export { SOURCES as RADAR_SOURCES };
