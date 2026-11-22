"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { encryptSecret } from "@/lib/crypto";
import { forgetOrgLlmConfig, getGateway } from "@/lib/llm";
import { MODEL_SPEC, PROVIDER_IDS, PROVIDERS, keyHint, parseModel, type ProviderId } from "@/lib/llm/catalog";
import type { ModelUse } from "@/lib/llm/models";
import { requireSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

// 「模型」页：贴各家 key、按用途选模型、试一下。key 加密后用 service role 写，页面只显示最后 4 位。

function back(params: { error?: string; notice?: string }): never {
  revalidatePath("/models");
  const query = new URLSearchParams(params as Record<string, string>).toString();
  redirect(`/models${query ? `?${query}` : ""}`);
}

const providerSchema = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);

export async function saveModelKey(provider: ProviderId, formData: FormData) {
  const { org } = await requireSession();
  providerSchema.parse(provider);
  const key = String(formData.get("key") ?? "").trim();
  if (!key) back({ error: "先把 key 粘进框里" });
  if (key.length > 400 || /\s/.test(key)) back({ error: "这串 key 看着不对：中间不能有空格或换行" });

  const { error } = await createAdminClient()
    .from("model_keys")
    .upsert({
      org_id: org.id,
      provider,
      ciphertext: encryptSecret(key),
      hint: keyHint(key),
      updated_at: new Date().toISOString(),
    });
  if (error) back({ error: error.message });
  forgetOrgLlmConfig(org.id);
  back({ notice: `${PROVIDERS[provider].label} 的 key 存好了` });
}

export async function deleteModelKey(provider: ProviderId) {
  const { org } = await requireSession();
  providerSchema.parse(provider);
  const { error } = await createAdminClient().from("model_keys").delete().eq("org_id", org.id).eq("provider", provider);
  if (error) back({ error: error.message });
  forgetOrgLlmConfig(org.id);
  back({ notice: `删掉了 ${PROVIDERS[provider].label} 的 key` });
}

function readSpec(formData: FormData, name: string): string | undefined {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) return undefined;
  if (!MODEL_SPEC.test(value)) back({ error: `模型名「${value}」不对，只能有字母、数字和 . - _ : /` });
  if (!parseModel(value) && !process.env.LLM_GATEWAY_URL) {
    back({ error: `看不出「${value}」是哪家的：写成「厂商/模型名」，例如 anthropic/claude-sonnet-5-5` });
  }
  return value;
}

export async function saveModelSettings(formData: FormData) {
  const { supabase, org } = await requireSession();
  const models = {
    write: readSpec(formData, "write"),
    assist: readSpec(formData, "assist"),
    image: readSpec(formData, "image"),
    openai_image: readSpec(formData, "openai_image"),
  };
  const provider = z.enum(["gemini", "openai", "off"]).parse(formData.get("image_provider") ?? "gemini");
  const { error } = await supabase
    .from("orgs")
    .update({
      settings: {
        ...org.settings,
        image_provider: provider,
        // 旧版 text 字段不再写；JSON 里去掉空值
        models: Object.fromEntries(Object.entries(models).filter(([, v]) => v)),
      },
    })
    .eq("id", org.id);
  if (error) back({ error: error.message });
  forgetOrgLlmConfig(org.id);
  back({ notice: "保存好了，一分钟内生效" });
}

/** 用当前设置真调一次，确认 key 和模型名都对（花不到一分钱） */
export async function testModel(use: ModelUse) {
  const { org } = await requireSession();
  forgetOrgLlmConfig(org.id);
  const llm = getGateway();
  const step = use === "write" ? "copy.post" : "topics.plan";
  const model = await llm.resolveModel({ orgId: org.id, step });
  let reply: string;
  try {
    reply = await llm.generate({
      orgId: org.id,
      step,
      messages: [{ role: "user", content: "用不超过 15 个字回一句：你是哪家公司的哪个模型？" }],
    });
  } catch (err) {
    back({ error: `${model} 没跑通：${err instanceof Error ? err.message : String(err)}`.slice(0, 600) });
  }
  back({ notice: `${model} 能用，它说：${reply.trim().slice(0, 80)}` });
}
