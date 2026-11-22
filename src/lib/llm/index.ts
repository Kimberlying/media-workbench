import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { LlmGateway, type OrgLlmConfig, type UsageSink } from "./gateway";
import { isProvider, type ProviderId } from "./catalog";
import type { OrgSettings } from "@/lib/db/types";

export { LlmGateway } from "./gateway";
export type { ChatMessage, OrgLlmConfig, UsageRecord, UsageSink } from "./gateway";

const supabaseUsageSink: UsageSink = {
  async record(usage) {
    const { error } = await createAdminClient().from("usage_logs").insert(usage);
    if (error) throw new Error(`写入 usage_logs 失败：${error.message}`);
  },
};

/** 组织设置里按用途选的模型；旧版只有一个 Gemini 模型名（text），写稿和整理都用它 */
export function modelsFromSettings(settings: OrgSettings | null | undefined): OrgLlmConfig["models"] {
  const models = settings?.models;
  const legacy = models?.text;
  return {
    ...(models?.write || legacy ? { write: models?.write || legacy } : {}),
    ...(models?.assist || legacy ? { assist: models?.assist || legacy } : {}),
  };
}

// 工作台「模型」页贴的 key 和选的模型，按组织缓存一分钟，改了很快生效
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; config: OrgLlmConfig }>();

export function forgetOrgLlmConfig(orgId: string) {
  cache.delete(orgId);
}

export async function orgLlmConfig(orgId: string | null): Promise<OrgLlmConfig> {
  if (!orgId) return { keys: {}, models: {} };
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.config;

  const db = createAdminClient();
  const [{ data: org }, { data: rows }] = await Promise.all([
    db.from("orgs").select("settings").eq("id", orgId).maybeSingle(),
    db.from("model_keys").select("provider, ciphertext").eq("org_id", orgId),
  ]);
  const keys: Partial<Record<ProviderId, string>> = {};
  for (const row of rows ?? []) {
    if (!isProvider(row.provider)) continue;
    try {
      keys[row.provider] = decryptSecret(row.ciphertext);
    } catch {
      // TOKEN_ENCRYPTION_KEY 换过就解不开：当没存，回到环境变量
    }
  }
  const config = { keys, models: modelsFromSettings(org?.settings as OrgSettings | null) };
  cache.set(orgId, { at: Date.now(), config });
  return config;
}

let gateway: LlmGateway | undefined;

export function getGateway(): LlmGateway {
  // 配了 LLM_GATEWAY_URL 就全部走 LiteLLM（搜 X 仍直连 xAI）；没配就按模型的厂商直连
  const viaLiteLlm = Boolean(process.env.LLM_GATEWAY_URL);
  gateway ??= new LlmGateway({
    baseUrl: process.env.LLM_GATEWAY_URL,
    apiKey: viaLiteLlm ? requireEnv("LLM_GATEWAY_KEY") : undefined,
    usage: supabaseUsageSink,
    orgConfig: orgLlmConfig,
    xai: process.env.XAI_API_KEY
      ? { apiKey: process.env.XAI_API_KEY, model: process.env.XAI_MODEL || "grok-4.7" }
      : undefined,
  });
  return gateway;
}
