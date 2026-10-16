import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { BufferClient, BufferRejected } from "@/lib/buffer/client";
import { bufferProblem, sendToBuffer, type BufferContent } from "@/lib/buffer/send";
import { confirmNowKeyboard, parseCallback, reviewKeyboard, reviewText } from "@/lib/telegram/bot";

type Reply = { data?: unknown; errors?: { message: string }[] } | Error;

/** 按顺序回放 Buffer 的响应，记下每次发出的 GraphQL */
function fakeBuffer(...replies: Reply[]) {
  const queries: string[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    queries.push(JSON.parse(String(init.body)).query);
    const reply = replies.shift()!;
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply));
  });
  return { client: new BufferClient("key", fetch as unknown as typeof globalThis.fetch), queries, fetch };
}

const ok = (id: string) => ({ data: { createPost: { post: { id } } } });
const mutationError = (message: string) => ({ data: { createPost: { message } } });

function fakeDb({ lockTaken = false } = {}) {
  const ops: string[] = [];
  const table = (name: string) => ({
    insert: () => {
      ops.push(`${name}.insert`);
      return {
        select: () => ({
          single: async () =>
            lockTaken ? { data: null, error: { message: "duplicate key" } } : { data: { id: "lock" }, error: null },
        }),
      };
    },
    update: (row: Record<string, unknown>) => {
      ops.push(`${name}.update ${JSON.stringify(row)}`);
      const chain = { eq: () => chain, then: (r: (v: unknown) => void) => r({ error: null }) };
      return chain;
    },
    delete: () => {
      ops.push(`${name}.delete`);
      return { eq: async () => ({ error: null }) };
    },
  });
  return { db: { from: table } as unknown as SupabaseClient, ops };
}

const content = (over: Partial<BufferContent> = {}): BufferContent =>
  ({
    id: "11111111-2222-3333-4444-555555555555",
    org_id: "o",
    variant: "linkedin:zh-CN:post",
    body: "一条 LinkedIn 帖子",
    status: "approved",
    media_urls: [],
    telegram_message_id: null,
    account: { platform: "linkedin", handle: "kim", buffer_channel_id: "ch1" },
    ...over,
  }) as BufferContent;

describe("Buffer 接口", () => {
  it("四种动作对应 Buffer 的 mode，存草稿带 saveToDraft，图片放进 assets", async () => {
    const { client, queries } = fakeBuffer(ok("p1"), ok("p2"), ok("p3"), ok("p4"));
    await client.createPost({ channelId: "ch", text: "a", action: "draft" });
    await client.createPost({ channelId: "ch", text: "a", action: "queue" });
    await client.createPost({ channelId: "ch", text: "a", action: "top" });
    await client.createPost({ channelId: "ch", text: '引号"和\n换行', action: "now", imageUrls: ["https://x/1.png"] });
    expect(queries[0]).toContain("mode: addToQueue, saveToDraft: true");
    expect(queries[1]).toContain("mode: addToQueue");
    expect(queries[1]).not.toContain("saveToDraft");
    expect(queries[2]).toContain("mode: shareNext");
    expect(queries[3]).toContain("mode: shareNow");
    expect(queries[3]).toContain('text: "引号\\"和\\n换行"');
    expect(queries[3]).toContain('assets: [{ image: { url: "https://x/1.png" } }]');
  });

  it("进入队列碰到队列已满：改存草稿，并说明", async () => {
    const { client, queries } = fakeBuffer(mutationError("Queue limit reached"), ok("p9"));
    await expect(client.createPost({ channelId: "ch", text: "a", action: "queue" })).resolves.toEqual({
      postId: "p9",
      fellBackToDraft: true,
    });
    expect(queries[1]).toContain("saveToDraft: true");
  });

  it("队列置顶碰到队列已满：不偷偷改存草稿", async () => {
    const { client, fetch } = fakeBuffer(mutationError("Queue limit reached"));
    await expect(client.createPost({ channelId: "ch", text: "a", action: "top" })).rejects.toBeInstanceOf(BufferRejected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("列出所有组织下的频道", async () => {
    const { client } = fakeBuffer(
      { data: { account: { organizations: [{ id: "org1" }] } } },
      { data: { channels: [{ id: "ch1", name: "kim", service: "linkedin" }] } },
    );
    await expect(client.channels()).resolves.toEqual([{ id: "ch1", name: "kim", service: "linkedin" }]);
  });
});

describe("交给 Buffer 不重复发", () => {
  it("成功：占位、补上 Buffer id；进入队列记为已排期，现在发送记为已发布", async () => {
    const queued = fakeDb();
    await sendToBuffer(queued.db, content(), "queue", fakeBuffer(ok("p1")).client);
    expect(queued.ops).toEqual(["posts.insert", 'posts.update {"platform_post_id":"p1"}', 'contents.update {"status":"scheduled"}']);

    const now = fakeDb();
    await sendToBuffer(now.db, content(), "now", fakeBuffer(ok("p2")).client);
    expect(now.ops.at(-1)).toBe('contents.update {"status":"published"}');
  });

  it("Buffer 明确拒绝：删掉占位；网络中断：保留占位，不再发", async () => {
    const rejected = fakeDb();
    await expect(sendToBuffer(rejected.db, content(), "top", fakeBuffer(mutationError("bad")).client)).rejects.toThrow("bad");
    expect(rejected.ops).toEqual(["posts.insert", "posts.delete"]);

    const uncertain = fakeDb();
    await expect(
      sendToBuffer(uncertain.db, content(), "top", fakeBuffer(new Error("socket hang up")).client),
    ).rejects.not.toBeInstanceOf(BufferRejected);
    expect(uncertain.ops).toEqual(["posts.insert"]);
  });

  it("已经交给过：不调用 Buffer", async () => {
    const { client, fetch } = fakeBuffer();
    await expect(sendToBuffer(fakeDb({ lockTaken: true }).db, content(), "queue", client)).rejects.toThrow("不会重复发送");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Instagram 没图、没配频道、还没批准、长文：都不能发", () => {
    expect(bufferProblem(content({ account: { platform: "instagram", handle: "k", buffer_channel_id: "c" } as BufferContent["account"], variant: "instagram:zh-CN:caption" }))).toContain("Instagram");
    expect(bufferProblem(content({ account: { platform: "linkedin", handle: "k", buffer_channel_id: null } as BufferContent["account"] }))).toContain("Buffer 频道");
    expect(bufferProblem(content({ status: "draft" }))).toContain("已批准");
    expect(bufferProblem(content({ variant: "x:zh-CN:article" }))).toContain("形式");
    expect(bufferProblem(content())).toBeNull();
  });
});

describe("Telegram 审核", () => {
  const id = content().id;

  it("按钮数据能解析回来，长度不超过 64 字节", () => {
    const buttons = [...reviewKeyboard(id), ...confirmNowKeyboard(id)].flat();
    for (const b of buttons) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(parseCallback(`bf:queue:${id}`)).toEqual({ kind: "send", action: "queue", contentId: id });
    expect(parseCallback(`bf:now?:${id}`)).toEqual({ kind: "confirm-now", contentId: id });
    expect(parseCallback(`bf:back:${id}`)).toEqual({ kind: "back", contentId: id });
    expect(parseCallback("bf:queue:not-a-uuid")).toBeNull();
    expect(parseCallback(`bf:delete:${id}`)).toBeNull();
  });

  it("「现在发送」第一下只换成确认按钮", () => {
    expect(reviewKeyboard(id).flat().find((b) => b.text === "现在发送")?.callback_data).toBe(`bf:now?:${id}`);
    expect(confirmNowKeyboard(id)[0][0].callback_data).toBe(`bf:now:${id}`);
  });

  it("审核消息带平台、形式、字数和图片数", () => {
    const text = reviewText(content({ media_urls: ["https://x/1.png"] }));
    expect(text).toContain("linkedin @kim");
    expect(text).toContain("字符数：");
    expect(text).toContain("图片：1 张");
    expect(text.endsWith("一条 LinkedIn 帖子")).toBe(true);
  });
});
