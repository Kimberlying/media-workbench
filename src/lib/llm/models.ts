// 每个环节默认用哪个模型。值是旧别名（grok、gemini-flash，见 catalog.ts）或「厂商/模型名」。
// 平时不用改这里：在工作台「模型」页按用途选模型（写稿、整理），在「账号与档案」里还能给单个账号另选。

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
  // X 短推和推文串也用 Gemini（2026-10-28 kim 定）：只办一个模型 key 就能跑；想换回 Grok 用 LLM_MODEL_OVERRIDES
  "copy.x_post": "gemini-flash",
  "copy.x_thread": "gemini-flash",
  "copy.longform": "gemini-flash",
  "copy.xhs_pack": "gemini-flash",
  "review.summary": "gemini-flash",
};

/** 「模型」页上的两种用途：写稿（各平台文案）和整理（打标签、摘要、选题、复盘）。搜 X 固定用 Grok */
export type ModelUse = "write" | "assist";

export const MODEL_USES: Record<ModelUse, { label: string; hint: string }> = {
  write: { label: "写稿", hint: "X、LinkedIn、Substack、长文、小红书等各平台文案" },
  assist: { label: "整理和选题", hint: "资讯打标签、素材和语音笔记整理、选题、复盘总结；用便宜快的就够" },
};

export function modelUseOf(step: Step): ModelUse | null {
  if (step === "radar.x") return null;
  return step.startsWith("copy.") ? "write" : "assist";
}

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
// 来源：docs.x.ai/developers/pricing、ai.google.dev/gemini-api/docs/pricing（2026-10 查）、platform.claude.com 价目。
// Grok 搜 X 另按抓到的帖子计费（每千条 5 美元），这里没算进去。
const PRICES: Record<string, { input: number; output: number }> = {
  "grok-4.7": { input: 2, output: 6 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 }, // 2027-01-01 起涨到 1.5 / 7.5
  // Anthropic 官方价（2026-11 查）
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
