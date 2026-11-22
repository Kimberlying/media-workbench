import { createAdminClient } from "@/lib/supabase/admin";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "./catalog";
import { listModels } from "./list-models";
import { orgLlmConfig } from "./index";

export interface ProviderStatus {
  provider: ProviderId;
  /** saved：在工作台里贴过；env：环境变量里有；none：都没有 */
  source: "saved" | "env" | "none";
  hint: string | null;
}

/** 每家的 key 在哪：工作台里贴的优先，其次环境变量 */
export async function providerStatuses(orgId: string): Promise<ProviderStatus[]> {
  const { data } = await createAdminClient().from("model_keys").select("provider, hint").eq("org_id", orgId);
  const saved = new Map((data ?? []).map((row) => [row.provider as string, row.hint as string]));
  return PROVIDER_IDS.map((provider) => {
    if (saved.has(provider)) return { provider, source: "saved", hint: saved.get(provider)! };
    if (process.env[PROVIDERS[provider].env]) return { provider, source: "env", hint: null };
    return { provider, source: "none", hint: null };
  });
}

/** 下拉候选：有 key 的厂商拉实时列表，写成「厂商/模型名」；一家都没有时给常用名 */
export async function modelOptions(orgId: string): Promise<string[]> {
  const { keys } = await orgLlmConfig(orgId);
  const lists = await Promise.all(
    PROVIDER_IDS.map(async (provider) => {
      const key = keys[provider] || process.env[PROVIDERS[provider].env];
      const ids = key ? await listModels(provider, key) : PROVIDERS[provider].suggestions;
      return ids.map((id) => `${provider}/${id}`);
    }),
  );
  return lists.flat();
}
