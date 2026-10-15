import type { ChatMessage } from "@/lib/llm";
import { ACCENTS, LAYOUTS, THEMES } from "./schema";

// 提示词按 build-xhs-content-pack 的 SKILL.md 和 references/ 改写：
// 先做 brief，再按解释链拆卡，每张卡只做一件事；正文补充判断，不复述卡片。

const CHAINS = `可选的解释链（选最小够用的一种）：
- 教程：封面 → 新手痛点 → 定义 → 第一次操作 → 常用功能 → 容易混淆的对比 → 模板 → 行动清单
- 读书/知识：封面 → 作者/书籍定位 → 核心问题 → 观点 1 → 观点 2 → 方法 → 应用 → 风险提醒
- 多资料对比：封面 → 共同问题 → 资料 A → 资料 B → 差异 → 组合方法 → 计划 → 清单
- 观点/X 长文：封面 → 现象 → 作者判断 → 证据 → 反例/边界 → 方法 → 结论 → 行动`;

const CARD_SCHEMA = `每张卡：{"file":"01_cover.png","layout":"${LAYOUTS.join("|")}","eyebrow","title","subtitle","accent":"${ACCENTS.join("|")}",
 "bullets":[...]（cover 最多 3 条亮点；list/steps 3–6 条，每条最好不超过 24 字）,
 "left":{"title","items":[]},"right":{"title","items":[]}（仅 compare）,
 "quote","note"（仅 quote）,"prompt"（仅 prompt，不超过 220 字）}
文件名用两位序号开头，按顺序编号。封面标题 8–20 字，内页标题 6–18 字。字太多就删字，不要堆。`;

const SAFETY = `内容边界：不编造实测、数据、案例和读者评价；不把作者观点写成无争议的事实；
不用「保证有效」「必然赚钱」一类承诺；投资、健康、法律等话题加上必要的风险提醒；
事实、来源观点和你的归纳要能区分开。`;

export function buildXhsPackPrompt(input: {
  handle: string;
  positioning: string;
  audience: string;
  tone: string;
  taboo: string[];
  topicTitle: string;
  angle: string;
  /** 已经写好的长文（X 长文或公众号长文），有的话以它为素材 */
  source?: string;
}): ChatMessage[] {
  const themes = Object.entries(THEMES)
    .map(([id, desc]) => `- ${id}：${desc}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        `你在为小红书账号 @${input.handle} 做一套图文内容包。账号定位：${input.positioning}；` +
        `目标读者：${input.audience}；语气：${input.tone}。绝对不能出现的词：${input.taboo.join("、") || "无"}。\n\n` +
        `步骤：先写 brief（这篇给谁看、他们会搜什么、记住哪一句话、为什么值得收藏、看完做什么、什么不能说），` +
        `把作者的个人判断当作主线；再按解释链拆成 8–12 张卡，第一张是封面，第二张是痛点或误区，中间是解释链，` +
        `最后一张是行动清单、可复用模板、总结或风险提醒。\n\n${CHAINS}\n\n${CARD_SCHEMA}\n\n` +
        `从下面四套视觉主题里挑最合适的一套：\n${themes}\n\n` +
        `再写发布材料：3–5 个标题备选；一段可直接发布的正文（300–600 字，补充个人判断、适合和不适合的人、背景和局限，` +
        `不要逐张复述卡片）；5–8 个精准标签（不带 #）；需要时写资料来源与原创说明。\n\n${SAFETY}\n\n` +
        `只返回 JSON：{"brief":{"topic","audience","search_question","core_idea","personal_judgment","save_reason",` +
        `"reader_action","must_not_claim":[],"needs_confirmation":[]},"theme","cards":[...],"titles":[],"body","tags":[],"source_notes"}`,
    },
    {
      role: "user",
      content:
        `选题：${input.topicTitle}\n切入角度：${input.angle}` +
        (input.source ? `\n\n素材（同一选题已写好的长文，拆卡时以它为准，不要机械切段）：\n${input.source}` : ""),
    },
  ];
}

export function buildWechatGraphicsPrompt(article: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        `你在给一篇公众号文章配横版贴图（1200×675）。只挑 3–6 个真正需要图解的点：` +
        `文章头图、流程、对比、框架、清单或总结。横版字数要比竖版卡片更少，要点每条不超过 18 字，prompt 不超过 120 字。\n\n` +
        `${CARD_SCHEMA}\n\n第一张用 cover 做文章头图。只返回 JSON：{"cards":[...]}`,
    },
    { role: "user", content: article },
  ];
}

/** 公众号长文从 X 长文改写：同一篇内容，改成公众号的读法 */
export function wechatAdaptation(xArticle: string): string {
  return (
    `\n\n下面是同一选题已经写好的 X 长文。保留它的观点、结构和例子，改写成公众号文章：` +
    `标题改成更适合公众号搜索和转发的说法，开头和段落过渡写完整，段落更短，去掉 X 特有的说法。` +
    `不要新增原文没有的事实或数据。\n\n${xArticle}`
  );
}
