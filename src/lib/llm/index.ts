import { createAdminClient } from "@/lib/supabase/admin";
import { requireEnv } from "@/lib/env";
import { LlmGateway, type UsageSink } from "./gateway";
import { directProviders } from "./providers";
import type { OrgSettings } from "@/lib/db/types";

export { LlmGateway } from "./gateway";
export type { ChatMessage, UsageRecord, UsageSink } from "./gateway";

const supabaseUsageSink: UsageSink = {
  async record(usage) {
    const { error } = await createAdminClient().from("usage_logs").insert(usage);
    if (error) throw new Error(`写入 usage_logs 失败：${error.message}`);
  },
};

// 工作台「账号与档案」里填的模型 ID，按组织缓存一分钟，改了很快生效
const MODEL_CACHE_MS = 60_000;
const modelCache = new Map<string, { at: number; ids: Partial<Record<string, string>> }>();

export async function orgModelIds(orgId: string | null): Promise<Partial<Record<string, string>>> {
  if (!orgId) return {};
  const hit = modelCache.get(orgId);
  if (hit && Date.now() - hit.at < MODEL_CACHE_MS) return hit.ids;
  const { data } = await createAdminClient().from("orgs").select("settings").eq("id", orgId).maybeSingle();
  const models = (data?.settings as OrgSettings | null)?.models;
  const ids = models?.text ? { "gemini-flash": models.text } : {};
  modelCache.set(orgId, { at: Date.now(), ids });
  return ids;
}

let gateway: LlmGateway | undefined;

export function getGateway(): LlmGateway {
  // 配了 LLM_GATEWAY_URL 就全部走 LiteLLM（搜 X 仍直连 xAI）；没配就按 key 直连 xAI 和 Gemini
  const viaLiteLlm = Boolean(process.env.LLM_GATEWAY_URL);
  gateway ??= new LlmGateway({
    baseUrl: process.env.LLM_GATEWAY_URL,
    apiKey: viaLiteLlm ? requireEnv("LLM_GATEWAY_KEY") : undefined,
    providers: viaLiteLlm ? undefined : directProviders(),
    usage: supabaseUsageSink,
    modelIds: orgModelIds,
    xai: process.env.XAI_API_KEY
      ? { apiKey: process.env.XAI_API_KEY, model: process.env.XAI_MODEL || "grok-4.7" }
      : undefined,
  });
  return gateway;
}
