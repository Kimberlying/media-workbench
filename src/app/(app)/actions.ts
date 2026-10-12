"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkTabooWords } from "@/lib/content/compliance";
import { assertTransition } from "@/lib/content/status";
import type { ContentStatus, KnowledgeType, Platform } from "@/lib/db/types";
import { weekStart } from "@/lib/dates";
import { loadKnowledge } from "@/lib/pipeline/copywriting";
import { requireSession } from "@/lib/session";
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

const PLATFORMS: Platform[] = ["x", "instagram", "facebook", "linkedin", "xiaohongshu"];

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
  const accountIds = formData.getAll("accountIds").map(String);
  if (accountIds.length === 0) return;
  // 确认选题属于当前用户可见的组织
  const { data: topic } = await supabase.from("topics").select("id").eq("id", topicId).single();
  if (!topic) throw new Error("找不到选题");
  await inngest.send({ name: EVENTS.contentsRequested, data: { topicId, accountIds } });
  await supabase.from("topics").update({ status: "selected" }).eq("id", topicId);
  revalidatePath("/topics");
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

/** 发布包平台：人工发完后在这里登记 */
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
