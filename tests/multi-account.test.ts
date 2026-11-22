import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mentionedHandles, planNote } from "@/lib/pipeline/telegram";

// 同一平台多个账号：Telegram 笔记给每个开着的号写一份，开头 @ 了谁就只写谁

const profile = { id: "p", org_id: "o", positioning: "", audience: "", tone: "", taboo: [], benchmarks: [], language: "zh-CN" };
const account = (id: string, platform: string, handle: string, over: Record<string, unknown> = {}) => ({
  id,
  org_id: "o",
  workspace_id: "w",
  platform,
  handle,
  profile_id: "p",
  token_ref: null,
  buffer_channel_id: null,
  telegram_enabled: true,
  model: null,
  profile,
  ...over,
});

/** 只实现 planNote 用到的几个查询 */
function fakeDb(note: string, accounts: ReturnType<typeof account>[]) {
  const inserted: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const result =
      table === "sources"
        ? { data: { id: "s", org_id: "o", workspace_id: "w", title: "t", digest: null, transcript: [{ start: 0, text: note }] } }
        : table === "accounts"
          ? { data: accounts }
          : { data: { id: "topic-1", ...inserted.at(-1) } };
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) builder[m] = () => builder;
    builder.insert = (row: Record<string, unknown>) => {
      inserted.push(row);
      return builder;
    };
    builder.single = async () => ({ ...result, error: null });
    builder.then = (resolve: (v: unknown) => void) => resolve({ ...result, error: null });
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const handlesOf = (plan: Awaited<ReturnType<typeof planNote>>) => plan!.targets.map((t) => t.account.handle);

describe("多账号", () => {
  it("认出笔记开头的 @账号名", () => {
    expect(mentionedHandles("@kim_ai @Kim.dev 今天做了个东西")).toEqual(["kim_ai", "kim.dev"]);
    expect(mentionedHandles("@a，@b、今天")).toEqual(["a", "b"]);
    expect(mentionedHandles("今天 @kim 帮我")).toEqual([]);
  });

  const accounts = [
    account("1", "x", "kim_ai"),
    account("2", "x", "kim_cn"),
    account("3", "linkedin", "kim"),
    account("4", "x", "kim_old", { telegram_enabled: false }),
    account("5", "x", "noprofile", { profile: null }),
  ];

  it("同平台每个开着 Telegram 线、有档案的号都写一份", async () => {
    expect(handlesOf(await planNote(fakeDb("今天的笔记", accounts), "s"))).toEqual(["kim_ai", "kim_cn", "kim"]);
  });

  it("开头 @ 了谁就只写谁，关掉 Telegram 线的号点名了也写", async () => {
    expect(handlesOf(await planNote(fakeDb("@KIM_CN @kim_old 今天", accounts), "s"))).toEqual(["kim_cn", "kim_old"]);
  });

  it("@ 的名字一个都对不上时当没点名", async () => {
    expect(handlesOf(await planNote(fakeDb("@nobody 今天", accounts), "s"))).toEqual(["kim_ai", "kim_cn", "kim"]);
  });
});
