import { z } from "zod";

// 与 build-xhs-content-pack 的渲染脚本（scripts/render_cards.py）同一套 cards.json 结构。
// 导出的 cards.json 可以直接交给它出图。
// https://github.com/Kimberlying/build-xhs-content-pack

export const THEMES = {
  editorial: "知识杂志：温和、有留白，适合观点、知识总结和长文摘要",
  "reading-card": "读书卡：纸张感、书签色，适合读书笔记、书单、金句和作者观点",
  "tech-tutorial": "科技教程：大留白、浅灰分区、少量系统蓝，适合 AI、工具与流程演示",
  business: "商务分析：杂志骨架加少量金融终端感，适合投资、商业框架",
} as const;

export type ThemeId = keyof typeof THEMES;

export const LAYOUTS = ["cover", "list", "steps", "compare", "quote", "prompt"] as const;
export const ACCENTS = ["coral", "green", "blue", "gold"] as const;

const Column = z.object({ title: z.string(), items: z.array(z.string()) });

export const Card = z.object({
  file: z.string(),
  layout: z.enum(LAYOUTS),
  eyebrow: z.string().default(""),
  title: z.string().default(""),
  subtitle: z.string().default(""),
  accent: z.enum(ACCENTS).default("coral"),
  bullets: z.array(z.string()).optional(),
  left: Column.optional(),
  right: Column.optional(),
  quote: z.string().optional(),
  note: z.string().optional(),
  prompt: z.string().optional(),
});
export type Card = z.infer<typeof Card>;

export const Brief = z.object({
  topic: z.string(),
  audience: z.string(),
  search_question: z.string(),
  core_idea: z.string(),
  personal_judgment: z.string(),
  save_reason: z.string(),
  reader_action: z.string(),
  must_not_claim: z.array(z.string()).default([]),
  needs_confirmation: z.array(z.string()).default([]),
});
export type Brief = z.infer<typeof Brief>;

/** 模型一次返回的小红书内容包 */
export const XhsPackDraft = z.object({
  brief: Brief,
  theme: z.enum(Object.keys(THEMES) as [ThemeId, ...ThemeId[]]).default("editorial"),
  cards: z.array(Card).min(1),
  titles: z.array(z.string()).min(1),
  body: z.string(),
  tags: z.array(z.string()).default([]),
  source_notes: z.string().default(""),
});
export type XhsPackDraft = z.infer<typeof XhsPackDraft>;

/** 公众号文章 + 横版贴图 */
export const WechatGraphicsDraft = z.object({
  cards: z.array(Card).max(6).default([]),
});

export interface CardsFile {
  meta: { title: string; width: number; height: number; theme: ThemeId; footer: string };
  cards: Card[];
}

/** 存在 contents.pack 里的内容包 */
export type ContentPack =
  | {
      kind: "xhs";
      brief: Brief;
      cards: CardsFile;
      titles: string[];
      tags: string[];
      source_notes: string;
      checks: string[];
    }
  | {
      kind: "longform";
      title: string;
      /** 公众号横版贴图；X 长文为空 */
      graphics: CardsFile | null;
      checks: string[];
    };

export const XHS_SIZE = { width: 1080, height: 1800 };
export const WECHAT_SIZE = { width: 1200, height: 675 };
