import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";
import { LlmGateway, type UsageSink } from "./gateway";
import { directProviders } from "./providers";

export { LlmGateway } from "./gateway";
export type { ChatMessage, UsageRecord, UsageSink } from "./gateway";

const supabaseUsageSink: UsageSink = {
  async record(usage) {
    const { error } = await createAdminClient().from("usage_logs").insert(usage);
    if (error) throw new Error(`写入 usage_logs 失败：${error.message}`);
  },
};

let gateway: LlmGateway | undefined;

export function getGateway(): LlmGateway {
  // 配了 LLM_GATEWAY_URL 就全部走 LiteLLM（搜 X 仍直连 xAI）；没配就按 key 直连 xAI 和 Gemini
  const viaLiteLlm = Boolean(process.env.LLM_GATEWAY_URL);
  gateway ??= new LlmGateway({
    baseUrl: process.env.LLM_GATEWAY_URL,
    apiKey: viaLiteLlm ? requireEnv("LLM_GATEWAY_KEY") : undefined,
    providers: viaLiteLlm ? undefined : directProviders(),
    usage: supabaseUsageSink,
    xai: process.env.XAI_API_KEY
      ? { apiKey: process.env.XAI_API_KEY, model: process.env.XAI_MODEL || "grok-4.7" }
      : undefined,
  });
  return gateway;
}
