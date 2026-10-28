import { z } from "zod";

// 素材（链接转写）存进 sources 表的两块结构化数据：文字稿分段和整理结果。

/** 文字稿的一段。start 是秒 */
export interface TranscriptSegment {
  start: number;
  text: string;
}

const Seconds = z.coerce.number().catch(0);

/** 模型整理出来的素材：摘要、章节、要点、金句、爆款拆解、可做的选题 */
export const SourceDigest = z.object({
  title: z.string().default(""),
  summary: z.string().default(""),
  chapters: z.array(z.object({ start: Seconds, title: z.string(), summary: z.string().default("") })).default([]),
  key_points: z.array(z.string()).default([]),
  /** text 是原话（原文语言），zh 是中文意思；原话本来就是中文时 zh 为空 */
  quotes: z.array(z.object({ start: Seconds, text: z.string(), zh: z.string().default("") })).default([]),
  /** 爆款拆解：开头怎么抓人、怎么展开、好在哪、写稿能借鉴什么 */
  breakdown: z
    .object({
      hook: z.string().default(""),
      structure: z.array(z.string()).default([]),
      why_it_works: z.string().default(""),
      reuse: z.string().default(""),
    })
    .prefault({}),
  angles: z.array(z.object({ title: z.string(), angle: z.string().default("") })).default([]),
});
export type SourceDigest = z.infer<typeof SourceDigest>;
