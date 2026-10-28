"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BUFFER_ACTIONS, BufferRejected, type BufferAction } from "@/lib/buffer/client";
import { bufferProblem, sendToBuffer, type BufferContent } from "@/lib/buffer/send";
import { checkTabooWords } from "@/lib/content/compliance";
import { getFormat, variantOf } from "@/lib/content/formats";
import { rewriteMaterial, type RewriteMode } from "@/lib/content/x-post";
import { getGateway } from "@/lib/llm";
import { MODEL_CHOICES } from "@/lib/llm/models";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ContentPack } from "@/lib/xhs/schema";
import { assertTransition } from "@/lib/content/status";
import type { ContentStatus, KnowledgeType, Platform } from "@/lib/db/types";
import { weekStart } from "@/lib/dates";
import { loadKnowledge } from "@/lib/pipeline/copywriting";
import { requireSession } from "@/lib/session";
import { requireEnv } from "@/lib/env";
import { TelegramBot } from "@/lib/telegram/bot";
import { detectPlatform, normalizeSourceUrl, SUPPORTED_HINT } from "@/lib/sources/platforms";
import type { SourceDigest } from "@/lib/sources/schema";
import { EVENTS, inngest } from "@/inngest/client";

// 所有写操作都用当前用户身份执行，RLS 保证只能动自己组织的数据。

function list(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[\n,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// 账号与档案
// ---------------------------------------------------------------------------

const PLATFORMS: Platform[] = ["x", "instagram", "facebook", "linkedin", "xiaohongshu", "wechat", "zhihu", "threads", "substack"];

export async function addManualAccount(formData: FormData) {
  const { supabase, org, workspace } = await requireSession();
  const platform = z.enum(PLATFORMS).parse(formData.get("platform"));
  const handle = String(formData.get("handle") ?? "").replace(/^@/, "").trim();
  if (!handle) redirect("/accounts?error=请填写账号名");

  const { error } = await supabase.from("accounts").insert({
    org_id: org.id,
    workspace_id: workspace.id,
    platform,
    handle,
  });
  if (error) redirect(`/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/accounts");
}

// 技术博主模板（building in public）：X 中文短推、Substack 英文长文、LinkedIn 英文帖。
// 已经有这个平台账号的跳过；档案之后在本页随时改。
const CREATOR_TEMPLATE: { platform: Platform; field: string; language: string; positioning: string; tone: string }[] = [
  {
    platform: "x",
    field: "x_handle",
    language: "zh-CN",
    positioning: "技术创作者，building in public：记录自己做 AI 产品和工程的过程、判断和踩坑",
    tone: "真诚、具体、像工程师跟同行聊天；有观点但不说满，不用营销腔",
  },
  {
    platform: "substack",
    field: "substack_handle",
    language: "en",
    positioning: "A builder's newsletter: what I'm building with AI, the decisions behind it, and what I learned",
    tone: "First person, honest and concrete; explain trade-offs and show the work; no hype",
  },
  {
    platform: "linkedin",
    field: "linkedin_handle",
    language: "en",
    positioning: "Technical builder sharing hands-on AI engineering work in public",
    tone: "Professional but personal; lead with the insight, back it with specifics; no buzzwords",
  },
];

/** 模型 ID 只收字母、数字和 . - _ :，空着就用默认 */
const MODEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export async function saveModelSettings(formData: FormData) {
  const { supabase, org } = await requireSession();
  const models: Record<string, string> = {};
  for (const key of ["text", "image", "openai_image"] as const) {
    const value = String(formData.get(key) ?? "").trim();
    if (!value) continue;
    if (!MODEL_ID.test(value)) redirect(`/accounts?error=${encodeURIComponent(`模型名「${value}」不对，只能有字母、数字和 . - _ :`)}`);
    models[key] = value;
  }
  const provider = z.enum(["gemini", "openai", "off"]).parse(formData.get("image_provider") ?? "gemini");
  const { error } = await supabase
    .from("orgs")
    .update({ settings: { ...org.settings, image_provider: provider, models } })
    .eq("id", org.id);
  if (error) redirect(`/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/accounts");
}

export async function setupCreatorTemplate(formData: FormData) {
  const { supabase, org, workspace } = await requireSession();
  const { data: existing } = await supabase.from("accounts").select("platform").eq("workspace_id", workspace.id);
  const have = new Set((existing ?? []).map((a) => a.platform as string));
  const audience = String(formData.get("audience") ?? "").trim() || "做 AI 产品的工程师、技术负责人和招聘方 / AI builders, engineers and hiring managers";

  for (const t of CREATOR_TEMPLATE) {
    if (have.has(t.platform)) continue;
    const handle = String(formData.get(t.field) ?? "").replace(/^@/, "").trim();
    if (!handle) continue;
    const { data: profile, error } = await supabase
      .from("account_profiles")
      .insert({ org_id: org.id, positioning: t.positioning, audience, tone: t.tone, language: t.language })
      .select("id")
      .single();
    if (error) redirect(`/accounts?error=${encodeURIComponent(error.message)}`);
    const { error: accountError } = await supabase.from("accounts").insert({
      org_id: org.id,
      workspace_id: workspace.id,
      platform: t.platform,
      handle,
      profile_id: profile.id,
    });
    if (accountError) redirect(`/accounts?error=${encodeURIComponent(accountError.message)}`);
  }
  revalidatePath("/accounts");
}

export async function saveProfile(accountId: string, formData: FormData) {
  const { supabase, org } = await requireSession();
  const profile = {
    org_id: org.id,
    positioning: String(formData.get("positioning") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    tone: String(formData.get("tone") ?? ""),
    taboo: list(formData.get("taboo")),
    benchmarks: list(formData.get("benchmarks")),
    language: String(formData.get("language") ?? "zh-CN"),
  };

  const { data: account, error } = await supabase
    .from("accounts")
    .select("id, profile_id")
    .eq("id", accountId)
    .single();
  if (error) throw new Error(error.message);

  if (account.profile_id) {
    const { error: updateError } = await supabase
      .from("account_profiles")
      .update(profile)
      .eq("id", account.profile_id);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { data: created, error: insertError } = await supabase
      .from("account_profiles")
      .insert(profile)
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    await supabase.from("accounts").update({ profile_id: created.id }).eq("id", accountId);
  }
  revalidatePath("/accounts");
}

// ---------------------------------------------------------------------------
// 知识库
// ---------------------------------------------------------------------------

const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "tone_guide",
  "taboo_words",
  "viral_post",
  "brand_material",
  "competitor",
];

export async function addKnowledge(formData: FormData) {
  const { supabase, org, workspace } = await requireSession();
  const type = z.enum(KNOWLEDGE_TYPES).parse(formData.get("type"));
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  const { error } = await supabase
    .from("knowledge_items")
    .insert({ org_id: org.id, workspace_id: workspace.id, type, content });
  if (error) throw new Error(error.message);
  revalidatePath("/knowledge");
}

export async function deleteKnowledge(id: string) {
  const { supabase } = await requireSession();
  await supabase.from("knowledge_items").delete().eq("id", id);
  revalidatePath("/knowledge");
}

// ---------------------------------------------------------------------------
// 选题
// ---------------------------------------------------------------------------

export async function requestTopics(accountId: string) {
  await requireSession();
  await inngest.send({ name: EVENTS.topicsRequested, data: { accountId } });
  revalidatePath("/topics");
}

export async function scheduleTopic(topicId: string, formData: FormData) {
  const { supabase } = await requireSession();
  const day = String(formData.get("week") ?? "");
  const week = day ? weekStart(new Date(`${day}T00:00:00Z`)) : weekStart(new Date());
  await supabase
    .from("topics")
    .update({ status: "scheduled", scheduled_week: week })
    .eq("id", topicId);
  revalidatePath("/topics");
}

export async function discardTopic(topicId: string) {
  const { supabase } = await requireSession();
  await supabase.from("topics").update({ status: "discarded" }).eq("id", topicId);
  revalidatePath("/topics");
}

export async function requestContents(topicId: string, formData: FormData) {
  const { supabase } = await requireSession();
  // 每个勾选项是「账号 id|内容形式」，例如 uuid|x.article
  const targets = formData
    .getAll("targets")
    .map(String)
    .map((v) => {
      const [accountId, format] = v.split("|");
      return { accountId, format: getFormat(format).id };
    });
  if (targets.length === 0) return;
  // 确认选题属于当前用户可见的组织
  const { data: topic } = await supabase.from("topics").select("id").eq("id", topicId).single();
  if (!topic) throw new Error("找不到选题");
  await inngest.send({ name: EVENTS.contentsRequested, data: { topicId, targets } });
  await supabase.from("topics").update({ status: "selected" }).eq("id", topicId);
  revalidatePath("/topics");
}

// ---------------------------------------------------------------------------
// 素材（链接转写）
// ---------------------------------------------------------------------------

export async function createSource(formData: FormData) {
  const { supabase, org, workspace, user } = await requireSession();
  const url = normalizeSourceUrl(String(formData.get("url") ?? ""));
  if (!url) redirect(`/sources?error=${encodeURIComponent(`这个链接转不了。${SUPPORTED_HINT}`)}`);
  const mode = formData.get("mode") === "native" ? "native" : "auto";

  // 同一个链接转过（或正在转）就直接打开，不重复扣积分
  const { data: existing } = await supabase
    .from("sources")
    .select("id")
    .eq("url", url)
    .neq("status", "failed")
    .limit(1)
    .maybeSingle();
  if (existing) redirect(`/sources?id=${existing.id}`);

  const { data, error } = await supabase
    .from("sources")
    .insert({
      org_id: org.id,
      workspace_id: workspace.id,
      url,
      platform: detectPlatform(url),
      mode,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) redirect(`/sources?error=${encodeURIComponent(error.message)}`);
  await inngest.send({ name: EVENTS.sourceRequested, data: { sourceId: data.id } });
  redirect(`/sources?id=${data.id}`);
}

export async function retrySource(sourceId: string, formData: FormData) {
  const { supabase } = await requireSession();
  const patch: Record<string, unknown> = { status: "pending", error: null };
  if (formData.get("mode") === "auto") patch.mode = "auto";
  const { data } = await supabase
    .from("sources")
    .update(patch)
    .eq("id", sourceId)
    .eq("status", "failed")
    .select("id, platform, transcript")
    .maybeSingle();
  if (data?.platform === "telegram") {
    // Telegram 笔记：已经有文字的从整理重来；语音没转出来的只能在 TG 里重发
    if (data.transcript) await inngest.send({ name: EVENTS.telegramNote, data: { sourceId } });
  } else if (data) {
    await inngest.send({ name: EVENTS.sourceRequested, data: { sourceId } });
  }
  revalidatePath("/sources");
}

export async function deleteSource(sourceId: string) {
  const { supabase } = await requireSession();
  await supabase.from("sources").delete().eq("id", sourceId);
  redirect("/sources");
}

/** 素材 → 选题 → 多平台文案：选一个切入角度和要写的账号、形式，后台按「生成文案」同一套流程写，素材带进提示词 */
export async function writeFromSource(sourceId: string, formData: FormData) {
  const { supabase, org } = await requireSession();
  const { data: source, error } = await supabase
    .from("sources")
    .select("id, title, digest")
    .eq("id", sourceId)
    .eq("status", "ready")
    .single();
  if (error) throw new Error("素材还没整理好");

  const digest = source.digest as SourceDigest;
  const pick = String(formData.get("angle") ?? "0");
  const custom = { title: String(formData.get("custom_title") ?? "").trim(), angle: String(formData.get("custom_angle") ?? "").trim() };
  const chosen =
    pick === "custom" && custom.title ? custom : (digest.angles[Number(pick)] ?? { title: digest.title || source.title, angle: "" });

  const targets = formData
    .getAll("targets")
    .map(String)
    .map((v) => {
      const [accountId, format] = v.split("|");
      return { accountId, format: getFormat(format).id };
    });
  if (targets.length === 0) redirect(`/sources?id=${sourceId}&error=${encodeURIComponent("至少勾一个要写的账号和形式")}`);

  const { data: topic, error: topicError } = await supabase
    .from("topics")
    .insert({
      org_id: org.id,
      account_id: targets[0].accountId,
      source_id: sourceId,
      title: chosen.title,
      angle: chosen.angle,
      status: "selected",
    })
    .select("id")
    .single();
  if (topicError) throw new Error(topicError.message);
  await inngest.send({ name: EVENTS.contentsRequested, data: { topicId: topic.id, targets } });
  redirect(`/sources?id=${sourceId}&sent=${targets.length}`);
}

// ---------------------------------------------------------------------------
// 内容
// ---------------------------------------------------------------------------

async function moveContent(contentId: string, to: ContentStatus, patch: Record<string, unknown> = {}) {
  const { supabase, org, user } = await requireSession();
  const { data: content, error } = await supabase
    .from("contents")
    .select("status")
    .eq("id", contentId)
    .single();
  if (error) throw new Error(error.message);
  assertTransition(content.status, to, org.settings);
  const { error: updateError } = await supabase
    .from("contents")
    .update({ status: to, updated_by: user.id, ...patch })
    .eq("id", contentId)
    .eq("status", content.status);
  if (updateError) throw new Error(updateError.message);
  revalidatePath("/contents");
}

export async function saveContentBody(contentId: string, formData: FormData) {
  const { supabase, user } = await requireSession();
  await supabase
    .from("contents")
    .update({ body: String(formData.get("body") ?? ""), updated_by: user.id, compliance_hits: [] })
    .eq("id", contentId)
    .eq("status", "draft");
  revalidatePath("/contents");
}

export async function submitContent(contentId: string, formData: FormData) {
  const { supabase, org, user } = await requireSession();
  const { data: content, error } = await supabase
    .from("contents")
    .select("body, account:accounts(workspace_id, profile:account_profiles(taboo))")
    .eq("id", contentId)
    .single();
  if (error) throw new Error(error.message);

  const body = formData.has("body") ? String(formData.get("body")) : content.body;
  const account = content.account as unknown as {
    workspace_id: string;
    profile: { taboo: string[] } | null;
  };
  const knowledge = await loadKnowledge(supabase, account.workspace_id);
  const compliance = checkTabooWords(body, [...(account.profile?.taboo ?? []), ...knowledge.tabooWords]);

  await supabase
    .from("contents")
    .update({ body, compliance_hits: compliance.hits, updated_by: user.id })
    .eq("id", contentId)
    .eq("status", "draft");
  if (!compliance.ok) {
    revalidatePath("/contents");
    return;
  }

  await moveContent(contentId, "compliance_check");
  await moveContent(contentId, org.settings.approval_required ? "pending_approval" : "approved");
}

export async function approveContent(contentId: string) {
  const { supabase, org, user } = await requireSession();
  await moveContent(contentId, "approved");
  await supabase
    .from("approvals")
    .insert({ org_id: org.id, content_id: contentId, reviewer_id: user.id, decision: "approved" });
}

export async function rejectContent(contentId: string, formData: FormData) {
  const { supabase, org, user } = await requireSession();
  const reason = String(formData.get("reason") ?? "") || null;
  await moveContent(contentId, "draft");
  if (org.settings.approval_required) {
    await supabase.from("approvals").insert({
      org_id: org.id,
      content_id: contentId,
      reviewer_id: user.id,
      decision: "rejected",
      reason,
    });
  }
}

export async function scheduleContent(contentId: string, formData: FormData) {
  const at = String(formData.get("scheduled_at") ?? "");
  const tz = Number(formData.get("tz_offset") ?? 0);
  if (!at) return;
  // datetime-local 没有时区，用浏览器提交的时区偏移换成 UTC
  const utc = new Date(new Date(`${at}:00Z`).getTime() + tz * 60_000).toISOString();
  await moveContent(contentId, "scheduled", { scheduled_at: utc });
}

/** 发布包平台：人工发完后在这里登记；交给 Buffer 的内容已有发布记录，这里只改状态 */
export async function markPublishedManually(contentId: string, formData: FormData) {
  const { supabase, org } = await requireSession();
  await moveContent(contentId, "published");
  await supabase.from("posts").insert({
    org_id: org.id,
    content_id: contentId,
    platform_post_id: String(formData.get("url") ?? "") || null,
    method: "manual",
  });
}

// ---------------------------------------------------------------------------
// X 短推：素材润色 / 翻译（tweet-buffer-workflow 的流程）
// 生成的稿子停在草稿，人看过、提交后才会进入排期和发布。
// ---------------------------------------------------------------------------

const RewriteInput = z.object({
  accountId: z.string().uuid(),
  mode: z.enum(["polish", "translate"]),
  model: z.enum(MODEL_CHOICES as [string, ...string[]]).optional(),
  material: z.string().trim().min(1).max(8000),
});

async function loadXAccount(accountId: string) {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, org_id, handle, platform, profile:account_profiles(tone, taboo, language), workspace_id")
    .eq("id", accountId)
    .eq("platform", "x")
    .single();
  if (error) throw new Error("找不到这个 X 账号");
  const profile = data.profile as unknown as { tone: string; taboo: string[]; language: string } | null;
  return { supabase, account: data, profile };
}

async function writeXPost(
  accountId: string,
  mode: RewriteMode,
  material: string,
  model: string | undefined,
  contentId?: string,
  newsId?: string,
) {
  const { user } = await requireSession();
  const { supabase, account, profile } = await loadXAccount(accountId);
  const { body, pack } = await rewriteMaterial(getGateway(), {
    orgId: account.org_id,
    handle: account.handle,
    tone: profile?.tone ?? "",
    mode,
    material,
    model,
    newsId,
  });
  const knowledge = await loadKnowledge(supabase, account.workspace_id);
  const compliance = checkTabooWords(body, [...(profile?.taboo ?? []), ...knowledge.tabooWords]);
  const row = { body, pack, compliance_hits: compliance.hits, updated_by: user.id };

  if (contentId) {
    const { error } = await supabase.from("contents").update(row).eq("id", contentId).eq("status", "draft");
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("contents").insert({
      ...row,
      org_id: account.org_id,
      account_id: account.id,
      variant: variantOf(getFormat("x.post"), profile?.language ?? "zh-CN"),
      status: "draft",
      created_by: user.id,
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/contents");
}

export async function rewriteToXPost(formData: FormData) {
  const input = RewriteInput.parse({
    accountId: formData.get("accountId"),
    mode: formData.get("mode"),
    model: formData.get("model") || undefined,
    material: formData.get("material"),
  });
  await writeXPost(input.accountId, input.mode, input.material, input.model);
  redirect("/contents?status=draft");
}

/** 重出：用同一份素材、同样的处理方式再写一版，替换当前草稿 */
export async function regenerateXPost(contentId: string) {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("contents")
    .select("account_id, pack, status")
    .eq("id", contentId)
    .single();
  if (error) throw new Error(error.message);
  const pack = data.pack as ContentPack | null;
  if (data.status !== "draft" || pack?.kind !== "post" || pack.mode === "topic" || !pack.source) {
    throw new Error("只有素材改写出来的草稿可以重出");
  }
  await writeXPost(data.account_id, pack.mode, pack.source, pack.model, contentId, pack.newsId);
}

// ---------------------------------------------------------------------------
// 发布结果不确定：后台发布中断时不会自动重发，由人到 X 上核对后在这里登记
// ---------------------------------------------------------------------------

export async function resolveUncertainPublish(contentId: string, formData: FormData) {
  const { supabase } = await requireSession();
  // 先用当前用户身份确认看得到这条内容
  const { data: content } = await supabase.from("contents").select("id").eq("id", contentId).single();
  if (!content) throw new Error("找不到内容");

  const admin = createAdminClient();
  const outcome = String(formData.get("outcome"));
  if (outcome === "published") {
    const url = String(formData.get("url") ?? "");
    const tweetId = url.match(/status\/(\d+)/)?.[1] ?? (url || null);
    await admin
      .from("posts")
      .update({ platform_post_id: tweetId })
      .eq("content_id", contentId)
      .is("platform_post_id", null);
    await admin.from("contents").update({ status: "published" }).eq("id", contentId).eq("status", "scheduled");
  } else {
    // 确认没发出去：去掉占位记录，下一轮会重新发布
    await admin.from("posts").delete().eq("content_id", contentId).is("platform_post_id", null);
  }
  revalidatePath("/contents");
}

// ---------------------------------------------------------------------------
// 经 Buffer 发布（LinkedIn、Instagram 等）：工作台直推，或推到 Telegram 再点按钮
// ---------------------------------------------------------------------------

export async function setBufferChannel(accountId: string, formData: FormData) {
  const { supabase } = await requireSession();
  const channelId = String(formData.get("buffer_channel_id") ?? "").trim() || null;
  const { error } = await supabase.from("accounts").update({ buffer_channel_id: channelId }).eq("id", accountId);
  if (error) redirect(`/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/accounts");
}

/** 用当前用户身份读，确认看得到这条内容；之后的写入用 service role */
async function loadBufferContent(contentId: string): Promise<BufferContent> {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("contents")
    .select("*, account:accounts(*)")
    .eq("id", contentId)
    .single();
  if (error || !data) throw new Error("找不到内容");
  return data as BufferContent;
}

function backToContents(status: string, notice: string): never {
  revalidatePath("/contents");
  redirect(`/contents?status=${status}&notice=${encodeURIComponent(notice)}`);
}

export async function saveMediaUrls(contentId: string, formData: FormData) {
  const { supabase } = await requireSession();
  // 每行一个地址；只收 https，Buffer 要能直接公开访问
  const urls = String(formData.get("media_urls") ?? "")
    .split(/\s+/)
    .filter((u) => /^https:\/\//.test(u));
  const { error } = await supabase.from("contents").update({ media_urls: urls }).eq("id", contentId);
  if (error) throw new Error(error.message);
  revalidatePath("/contents");
}

export async function sendContentToBuffer(contentId: string, formData: FormData) {
  const action = z.enum(Object.keys(BUFFER_ACTIONS) as [BufferAction, ...BufferAction[]]).parse(formData.get("action"));
  const content = await loadBufferContent(contentId);
  let notice: string;
  try {
    notice = (await sendToBuffer(createAdminClient(), content, action)).summary;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    notice =
      err instanceof BufferRejected
        ? `没有交给 Buffer：${reason}`
        : `结果不确定，不会重发：${reason}。请到 Buffer 核对后在下面登记。`;
  }
  backToContents("approved", notice);
}

export async function sendContentToTelegram(contentId: string) {
  const content = await loadBufferContent(contentId);
  const problem = bufferProblem(content);
  if (problem) backToContents("approved", problem);
  const bot = new TelegramBot({ token: requireEnv("TELEGRAM_BOT_TOKEN"), chatId: requireEnv("TELEGRAM_CHAT_ID") });
  const messageId = await bot.sendReview(content);
  // 记下这条消息，TG 回调只认它；重新推送后旧消息上的按钮失效
  const { error } = await createAdminClient()
    .from("contents")
    .update({ telegram_message_id: messageId })
    .eq("id", content.id);
  if (error) throw new Error(error.message);
  backToContents("approved", "已推到 Telegram，在 TG 里选怎么交给 Buffer");
}

/** 交给 Buffer 时中断：到 Buffer 看过之后在这里登记 */
export async function resolveUncertainBuffer(contentId: string, formData: FormData) {
  await loadBufferContent(contentId);
  const admin = createAdminClient();
  if (String(formData.get("outcome")) === "in_buffer") {
    await admin
      .from("posts")
      .update({ platform_post_id: "已在 Buffer 核对" })
      .eq("content_id", contentId)
      .is("platform_post_id", null);
    await admin.from("contents").update({ status: "scheduled" }).eq("id", contentId).eq("status", "approved");
  } else {
    await admin.from("posts").delete().eq("content_id", contentId).is("platform_post_id", null);
  }
  revalidatePath("/contents");
}
