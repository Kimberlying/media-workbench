// 每个环节用哪个模型。值是模型网关（LiteLLM）里配置的别名，见 litellm/config.yaml。
// 换模型只改这里或网关配置，不改业务代码。

export const STEPS = [
  "radar.x", // 资讯雷达：X 热点
  "radar.web", // 资讯雷达：全网动态（带搜索）
  "radar.tag", // 资讯入库打标签与摘要
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
  "radar.web": "gemini-search",
  "radar.tag": "gemini-flash",
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

// 个别环节需要额外的请求参数，原样透传给网关。
// 全网动态要开 Gemini 的 Google 搜索；Grok 搜 X 的参数随 xAI 接口调整，接入时按当时文档补上。
export const STEP_PARAMS: Partial<Record<Step, Record<string, unknown>>> = {
  "radar.web": { tools: [{ googleSearch: {} }] },
};
