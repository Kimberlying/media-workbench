import type { SupabaseClient } from "@supabase/supabase-js";
import { NonRetriableError } from "inngest";
import { getConnector, PublishRejected, publishesViaApi } from "@/lib/connectors";
import type { Account, Content, MetricSnapshot } from "@/lib/db/types";
import { loadAccessToken } from "@/lib/secrets";

// 发布与取数都在后台任务里用 service role 跑；令牌只在服务端解密。

/** 找出到点、平台支持 API 发布、还没有发布记录的已排期内容 */
export async function dueContents(db: SupabaseClient, now = new Date()) {
  const { data, error } = await db
    .from("contents")
    .select("*, account:accounts(*), posts(id)")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .limit(50);
  if (error) throw new Error(error.message);
  type Row = Content & { account: Account; posts: { id: string }[] };
  return ((data ?? []) as Row[])
    .filter((row) => row.posts.length === 0 && publishesViaApi(row.account.platform, row.variant));
}

/**
 * 发布一条内容。先写一条没有平台 id 的发布记录占位，再调平台接口：
 * - 成功：补上平台 id，内容改为已发布
 * - 平台明确拒绝（什么都没发出去）：删掉占位，下一轮可以重试
 * - 其他失败（网络中断、推文串发到一半）：保留占位，不再自动重发，由人到平台核对
 *   （tweet-buffer-workflow 的规则：结果不确定时不要重复发布）
 */
export async function publishContent(
  db: SupabaseClient,
  content: Content & { account: Account },
): Promise<string> {
  // 令牌先取好：这一步失败时还什么都没发，可以放心重试
  const accessToken = await loadAccessToken(db, content.account);

  const { data: lock, error: lockError } = await db
    .from("posts")
    .insert({ org_id: content.org_id, content_id: content.id, platform_post_id: null, method: "api" })
    .select("id")
    .single();
  if (lockError) {
    // 唯一索引冲突：上一次尝试已经占位，结果不确定，不能再发
    throw new NonRetriableError(`这条内容已有发布记录，结果待核对：${lockError.message}`);
  }

  let platformPostId: string;
  try {
    const result = await getConnector(content.account.platform).publish({ body: content.body }, { accessToken });
    if (result.method !== "api") throw new PublishRejected(`${content.account.platform} 没有 API 发布，应走发布包`);
    platformPostId = result.platformPostId;
  } catch (err) {
    if (err instanceof PublishRejected) {
      await db.from("posts").delete().eq("id", lock.id);
    }
    throw err;
  }

  const { error: postError } = await db.from("posts").update({ platform_post_id: platformPostId }).eq("id", lock.id);
  if (postError) throw new Error(postError.message);

  const { error } = await db
    .from("contents")
    .update({ status: "published" })
    .eq("id", content.id)
    .eq("status", "scheduled");
  if (error) throw new Error(error.message);
  return platformPostId;
}

/** 拉取近 N 天 API 发布的帖子数据，按天写快照 */
export async function syncMetrics(db: SupabaseClient, { days = 30, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  const { data, error } = await db
    .from("posts")
    .select("id, org_id, platform_post_id, content:contents(account:accounts(*))")
    .eq("method", "api")
    .gte("published_at", since)
    .not("platform_post_id", "is", null);
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    org_id: string;
    platform_post_id: string;
    content: { account: Account };
  };
  const byAccount = new Map<string, { account: Account; posts: Row[] }>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const account = row.content.account;
    const entry = byAccount.get(account.id) ?? { account, posts: [] };
    entry.posts.push(row);
    byAccount.set(account.id, entry);
  }

  const date = now.toISOString().slice(0, 10);
  let written = 0;
  for (const { account, posts } of byAccount.values()) {
    const accessToken = await loadAccessToken(db, account);
    const metrics: Map<string, MetricSnapshot> = await getConnector(account.platform).fetchMetrics(
      posts.map((p) => p.platform_post_id),
      { accessToken },
    );
    const rows = posts
      .filter((p) => metrics.has(p.platform_post_id))
      .map((p) => ({ post_id: p.id, org_id: p.org_id, date, ...metrics.get(p.platform_post_id)! }));
    if (rows.length === 0) continue;
    const { error: upsertError } = await db.from("metrics").upsert(rows, { onConflict: "post_id,date" });
    if (upsertError) throw new Error(upsertError.message);
    written += rows.length;
  }
  return written;
}
