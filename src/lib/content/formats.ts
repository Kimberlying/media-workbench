import type { Platform } from "@/lib/db/types";
import type { Step } from "@/lib/llm/models";

// 内容形式：一个平台可以有多种形式（X 有推文串和长文）。
// variant 存成 `${platform}:${language}:${format}`。
//
// kind 决定怎么生成：
// - text：一段正文
// - longform：标题 + Markdown 长文（X 长文、公众号长文）
// - xhs-pack：小红书内容包（知识卡 + 发布正文），结构沿用 build-xhs-content-pack

export type FormatKind = "text" | "longform" | "xhs-pack";

export interface FormatSpec {
  id: string;
  platform: Platform;
  format: string;
  label: string;
  kind: FormatKind;
  step: Step;
  /** 这个形式能不能走平台 API 自动发布；不能的生成发布包人工发 */
  apiPublish: boolean;
  guide: string;
}

const LONGFORM_RULES =
  "标题要具体、能被搜索到，不做无依据的承诺。开头用一个具体的矛盾或问题引入，" +
  "接着亮出核心观点，正文按逻辑分成 3–6 个小节（用 ## 二级标题），给出例子、边界和反例，" +
  "结尾落到读者能做的事。保留作者的个人判断，但不要把判断写成定论。";

export const FORMATS: FormatSpec[] = [
  {
    id: "x.thread",
    platform: "x",
    format: "thread",
    label: "X 推文串",
    kind: "text",
    step: "copy.x_thread",
    apiPublish: true,
    guide:
      "写一条 X 推文串，3–6 条，每条不超过 280 个字符（中文约 140 字）。" +
      "条与条之间用单独一行 --- 分隔。第一条要能单独成立、抓人。",
  },
  {
    id: "x.article",
    platform: "x",
    format: "article",
    label: "X 长文",
    kind: "longform",
    step: "copy.longform",
    // X 的长文（Articles）没有开放发布接口，生成后人工发
    apiPublish: false,
    guide: `写一篇 X 长文（Articles），2000–4000 字。${LONGFORM_RULES}`,
  },
  {
    id: "wechat.article",
    platform: "wechat",
    format: "article",
    label: "公众号长文",
    kind: "longform",
    step: "copy.longform",
    apiPublish: false,
    guide:
      `写一篇微信公众号文章，2000–4000 字，适合连续阅读。${LONGFORM_RULES}` +
      "语气比 X 更完整、更有过渡；段落短，适合手机阅读。",
  },
  {
    id: "xiaohongshu.pack",
    platform: "xiaohongshu",
    format: "pack",
    label: "小红书内容包",
    kind: "xhs-pack",
    step: "copy.xhs_pack",
    apiPublish: false,
    guide: "",
  },
  {
    id: "instagram.caption",
    platform: "instagram",
    format: "caption",
    label: "Instagram 配文",
    kind: "text",
    step: "copy.post",
    apiPublish: false,
    guide: "写一段 Instagram 配文，150–300 字，结尾 5–10 个话题标签。",
  },
  {
    id: "facebook.post",
    platform: "facebook",
    format: "post",
    label: "Facebook 帖子",
    kind: "text",
    step: "copy.post",
    apiPublish: false,
    guide: "写一条 Facebook 主页帖子，200–400 字，口语化，结尾一个互动问题。",
  },
  {
    id: "linkedin.post",
    platform: "linkedin",
    format: "post",
    label: "LinkedIn 帖子",
    kind: "text",
    step: "copy.post",
    apiPublish: false,
    guide: "写一条 LinkedIn 帖子，300–600 字，专业但不生硬，分段清楚，结尾 3 个话题标签。",
  },
];

const BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

export function getFormat(id: string): FormatSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`未知的内容形式 ${id}`);
  return spec;
}

export function formatsFor(platform: Platform): FormatSpec[] {
  return FORMATS.filter((f) => f.platform === platform);
}

/** 从 variant（platform:language:format）找回形式 */
export function formatOfVariant(variant: string): FormatSpec {
  const [platform, , format] = variant.split(":");
  return getFormat(`${platform}.${format}`);
}

export function variantOf(spec: FormatSpec, language: string): string {
  return `${spec.platform}:${language}:${spec.format}`;
}
