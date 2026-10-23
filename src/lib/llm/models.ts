// 每个环节用哪个模型。值是模型别名：走 LiteLLM 时见 litellm/config.yaml，直连时见 providers.ts。
// 换模型只改这里或网关配置，不改业务代码。

export const STEPS = [
  "radar.x", // 资讯雷达：X 热点（Grok 实时搜 X）
  "radar.tag", // 资讯入库打标签与摘要
  "source.digest", // 素材：视频、播客文字稿整理成摘要、章节、金句和拆解
  "topics.plan", // 选题策划
  "copy.post", // 多平台文案
  "copy.x_post", // X 短推（含素材润色、翻译）
  "copy.x_thread", // X 推文串
  "copy.longform", // X 长文、公众号长文
  "copy.xhs_pack", // 小红书内容包、公众号贴图
  "review.summary", // 数据复盘总结
] as const;

export type Step = (typeof STEPS)[number];

const DEFAULT_MODELS: Record<Step, string> = {
  "radar.x": "grok",
  "radar.tag": "gemini-flash",
  "source.digest": "gemini-flash",
  "topics.plan": "gemini-flash",
  "copy.post": "gemini-flash",
  "copy.x_post": "grok",
  "copy.x_thread": "grok",
  "copy.longform": "gemini-flash",
  "copy.xhs_pack": "gemini-flash",
  "review.summary": "gemini-flash",
};

/** 可在界面上手动选的模型：网关里配置的全部别名 */
export const MODEL_CHOICES = [...new Set(Object.values(DEFAULT_MODELS))];

// 可用环境变量 LLM_MODEL_OVERRIDES='{"copy.post":"gemini-pro"}' 临时覆盖
export function modelFor(step: Step, overrides = process.env.LLM_MODEL_OVERRIDES): string {
  if (overrides) {
    try {
      const parsed = JSON.parse(overrides) as Partial<Record<Step, string>>;
      if (parsed[step]) return parsed[step];
    } catch {
      // 配置写错时回到默认值
    }
  }
  return DEFAULT_MODELS[step];
}

// 直连（不经过 LiteLLM）时按这里的单价记费用，美元 / 百万 token。没列的模型记 0。
// 来源：docs.x.ai/developers/pricing、ai.google.dev/gemini-api/docs/pricing（2026-10 查）。
// Grok 搜 X 另按抓到的帖子计费（每千条 5 美元），这里没算进去。
const PRICES: Record<string, { input: number; output: number }> = {
  "grok-4.7": { input: 2, output: 6 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 }, // 2027-01-01 起涨到 1.5 / 7.5
};

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
