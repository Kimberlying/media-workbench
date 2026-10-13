import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";
import { LlmGateway, type UsageSink } from "./gateway";

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
  gateway ??= new LlmGateway({
    baseUrl: requireEnv("LLM_GATEWAY_URL"),
    apiKey: requireEnv("LLM_GATEWAY_KEY"),
    usage: supabaseUsageSink,
  });
  return gateway;
}
