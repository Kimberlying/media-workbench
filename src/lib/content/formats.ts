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

// X 短推的写法来自 tweet-buffer-workflow 的「润色」规则
// https://github.com/Kimberlying/tweet-buffer-workflow
export const X_POST_MAX = 250;

export const X_POST_RULES =
  `不超过 ${X_POST_MAX} 个字符；分成 2–4 个适合手机阅读的短段落；默认不用 emoji；` +
  "保留原意、事实、数字、人名、链接和不确定性，不编造背景、来源和结果；" +
  "结尾不用问号，不加「转发」「关注我」「评论区告诉我」一类引导互动的话。";

export const FORMATS: FormatSpec[] = [
  {
    id: "x.post",
    platform: "x",
    format: "post",
    label: "X 短推",
    kind: "text",
    step: "copy.x_post",
    apiPublish: true,
    guide: `写一条 X 短推：${X_POST_RULES}`,
  },
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
    id: "zhihu.answer",
    platform: "zhihu",
    format: "answer",
    label: "知乎回答",
    kind: "longform",
    step: "copy.longform",
    // 知乎没有开放发布接口，生成发布包人工发
    apiPublish: false,
    guide:
      "写一篇知乎回答，1500–3000 字。第一行用「# 问题」写一个读者真的会在知乎搜的问题，正文是对它的回答：" +
      "开头两三句直接给结论，再分 3–5 个小节（用 ## 二级标题）讲理由、例子和亲身判断，引用的数据和说法注明来源，" +
      "结尾给出适合谁、不适合谁。语气像懂行的人认真回答，不写营销腔，不用「谢邀」。",
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
    id: "threads.post",
    platform: "threads",
    format: "post",
    label: "Threads 帖子",
    kind: "text",
    step: "copy.post",
    apiPublish: false,
    guide:
      "写一条 Threads 帖子，不超过 500 个字符，口语化、像跟朋友聊天，1–3 个短段落，第一句就说重点；" +
      "最多 1 个话题标签，不用引导互动的套话。",
  },
  {
    id: "substack.article",
    platform: "substack",
    format: "article",
    label: "Substack 长文",
    kind: "longform",
    step: "copy.longform",
    // Substack 没有发布接口，生成复制包人工贴进编辑器
    apiPublish: false,
    guide:
      "写一篇 Substack newsletter 长文，英文 1200–2000 词（中文 2500–4000 字）。" +
      "第一人称，像作者在跟订阅者讲自己正在做的事：开头一段讲清这期要说什么、为什么现在值得说，" +
      "正文分 3–5 个小节（用 ## 二级标题），讲做法、取舍、踩过的坑和具体细节（工具、数字、代码思路），" +
      "结尾写学到了什么、下一步做什么。不写营销腔，不编造没做过的事和结果。",
  },
  {
    id: "linkedin.post",
    platform: "linkedin",
    format: "post",
    label: "LinkedIn 帖子",
    kind: "text",
    step: "copy.post",
    apiPublish: false,
    guide:
      "写一条 LinkedIn 帖子，英文 150–300 词（中文 300–600 字），专业但不生硬，分段清楚。" +
      "第一行就说结论或一个具体的问题；技术内容讲清做了什么、为什么这样做、结果如何；结尾 3 个话题标签。",
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
