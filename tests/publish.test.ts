import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Account, Content } from "@/lib/db/types";

// 发布占位逻辑：只替换平台连接器和令牌读取
const publish = vi.fn();
vi.mock("@/lib/connectors", async (orig) => ({
  ...(await orig<typeof import("@/lib/connectors")>()),
  getConnector: () => ({ publish }),
}));
vi.mock("@/lib/secrets", () => ({ loadAccessToken: async () => "token" }));

const { publishContent } = await import("@/lib/pipeline/publish");
const { PublishRejected } = await import("@/lib/connectors");

/** 记录对 posts / contents 的写入；lockTaken 模拟唯一索引冲突 */
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

const content = {
  id: "c",
  org_id: "o",
  body: "一条短推",
  account: { platform: "x" } as Account,
} as Content & { account: Account };

describe("后台发布不重复发", () => {
  it("成功：先占位，再补上平台 id，内容改为已发布", async () => {
    publish.mockResolvedValueOnce({ method: "api", platformPostId: "123" });
    const { db, ops } = fakeDb();
    await expect(publishContent(db, content)).resolves.toBe("123");
    expect(ops).toEqual([
      "posts.insert",
      'posts.update {"platform_post_id":"123"}',
      'contents.update {"status":"published"}',
    ]);
  });

  it("平台明确拒绝：删掉占位，可以重试", async () => {
    publish.mockRejectedValueOnce(new PublishRejected("403"));
    const { db, ops } = fakeDb();
    await expect(publishContent(db, content)).rejects.toThrow("403");
    expect(ops).toEqual(["posts.insert", "posts.delete"]);
  });

  it("结果不确定（网络中断）：保留占位，不再发", async () => {
    publish.mockRejectedValueOnce(new Error("socket hang up"));
    const { db, ops } = fakeDb();
    await expect(publishContent(db, content)).rejects.toThrow("socket hang up");
    expect(ops).toEqual(["posts.insert"]);
  });

  it("已有占位（任务重试）：不调用平台接口", async () => {
    publish.mockClear();
    const { db } = fakeDb({ lockTaken: true });
    await expect(publishContent(db, content)).rejects.toThrow("结果待核对");
    expect(publish).not.toHaveBeenCalled();
  });
});
