import type { SupabaseClient } from "@supabase/supabase-js";
import { formatOfVariant } from "@/lib/content/formats";
import type { Account, Content } from "@/lib/db/types";
import { requireEnv } from "@/lib/env";
import { BUFFER_ACTIONS, BufferClient, BufferRejected, type BufferAction } from "./client";

// 把一条已批准的内容交给 Buffer。工作台按钮和 Telegram 按钮都走这里。
// 和 X 自动发布同一套防重发：先写一条没有平台 id 的发布记录占位，再调 Buffer：
// - 成功：补上 Buffer 帖子 id；现在发送记为已发布，其余记为已排期（之后在 Buffer 里发出）
// - Buffer 明确拒绝：删掉占位，改了可以再发
// - 其他失败（网络中断等）：保留占位，不再重发，由人到 Buffer 核对

export type BufferContent = Content & { account: Account };

/** 这条内容能不能交给 Buffer：账号配了 Buffer 频道，且是一段正文（长文、小红书包不行） */
export function canSendToBuffer(content: BufferContent): boolean {
  if (!content.account.buffer_channel_id) return false;
  try {
    return formatOfVariant(content.variant).kind === "text";
  } catch {
    return false;
  }
}

export function bufferProblem(content: BufferContent): string | null {
  if (!canSendToBuffer(content)) return "这个账号没有配 Buffer 频道，或这种形式不能交给 Buffer";
  if (content.status !== "approved") return "只有已批准的内容可以交给 Buffer";
  if (content.account.platform === "instagram" && content.media_urls.length === 0) {
    return "Instagram 至少要一张图片（公开的 https 地址）";
  }
  return null;
}

export interface BufferSendResult {
  postId: string;
  /** 进入队列时队列已满，改存了草稿 */
  fellBackToDraft: boolean;
  summary: string;
}

export async function sendToBuffer(
  db: SupabaseClient,
  content: BufferContent,
  action: BufferAction,
  client = new BufferClient(requireEnv("BUFFER_API_KEY")),
): Promise<BufferSendResult> {
  const problem = bufferProblem(content);
  if (problem) throw new BufferRejected(problem);

  const { data: lock, error: lockError } = await db
    .from("posts")
    .insert({ org_id: content.org_id, content_id: content.id, platform_post_id: null, method: "buffer" })
    .select("id")
    .single();
  if (lockError) {
    // 唯一索引冲突：已经交给过 Buffer，或上一次结果不确定
    throw new BufferRejected("这条内容已经交给过 Buffer，或上一次结果待核对，不会重复发送");
  }

  let result: { postId: string; fellBackToDraft: boolean };
  try {
    result = await client.createPost({
      channelId: content.account.buffer_channel_id!,
      text: content.body,
      action,
      imageUrls: content.media_urls,
    });
  } catch (err) {
    if (err instanceof BufferRejected) await db.from("posts").delete().eq("id", lock.id);
    throw err;
  }

  const { error: postError } = await db.from("posts").update({ platform_post_id: result.postId }).eq("id", lock.id);
  if (postError) throw new Error(postError.message);
  const published = action === "now" && !result.fellBackToDraft;
  const { error } = await db
    .from("contents")
    .update({ status: published ? "published" : "scheduled" })
    .eq("id", content.id)
    .eq("status", "approved");
  if (error) throw new Error(error.message);

  const summary = result.fellBackToDraft
    ? "Buffer 队列已满，已改存为草稿"
    : `已交给 Buffer：${BUFFER_ACTIONS[action]}`;
  return { ...result, summary };
}
