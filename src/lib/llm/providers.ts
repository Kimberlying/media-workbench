import type { Provider } from "./gateway";

// 不用 LiteLLM 时，各别名直连哪家。两家都是 OpenAI 兼容接口，配了 key 才启用。
// 模型 ID 可用环境变量换，不改代码。
export function directProviders(env: Record<string, string | undefined> = process.env): Record<string, Provider> {
  const providers: Record<string, Provider> = {};
  if (env.XAI_API_KEY) {
    providers.grok = { baseUrl: "https://api.x.ai/v1", apiKey: env.XAI_API_KEY, model: env.XAI_MODEL || "grok-4.7" };
  }
  if (env.GEMINI_API_KEY) {
    providers["gemini-flash"] = {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || "gemini-3.8-flash",
    };
  }
  return providers;
}
