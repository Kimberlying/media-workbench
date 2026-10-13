import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFormat } from "@/lib/content/formats";
import type { Account, AccountProfile, Topic } from "@/lib/db/types";
import { LlmGateway, type ChatMessage } from "@/lib/llm/gateway";
import { generateContents, orderTargets, titleOf } from "@/lib/pipeline/copywriting";

const profile: AccountProfile = {
  id: "p",
  org_id: "o",
  positioning: "AI 工具实测",
  audience: "独立开发者",
  tone: "直接",
  taboo: ["稳赚"],
  benchmarks: [],
  language: "zh-CN",
};
const account = (platform: Account["platform"], id = platform): Account => ({
  id,
  org_id: "o",
  workspace_id: "w",
  platform,
  handle: "kim",
  profile_id: "p",
  token_ref: null,
});
const topic = { id: "t", org_id: "o", title: "新模型发布", angle: "对比上一代" } as Topic;

const xhsDraft = {
  brief: {
    topic: "新模型",
    audience: "开发者",
    search_question: "q",
    core_idea: "c",
    personal_judgment: "j",
    save_reason: "s",
    reader_action: "a",
  },
  theme: "tech-tutorial",
  cards: Array.from({ length: 8 }, (_, i) => ({
    file: `${String(i + 1).padStart(2, "0")}_c.png`,
    layout: i === 0 ? "cover" : "list",
    title: `卡片标题${i + 1}`,
    bullets: ["一", "二", "三"],
  })),
  titles: ["标题"],
  body: "正文",
  tags: ["AI"],
};

/** 记下每次请求，按请求内容返回固定结果 */
function fakeLlm() {
  const calls: { model: string; messages: ChatMessage[] }[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const req = JSON.parse(String(init?.body));
    calls.push(req);
    const sys = req.messages[0].content as string;
    const user = req.messages[1].content as string;
    let content = "正文";
    if (sys.includes("小红书账号")) content = JSON.stringify(xhsDraft);
    else if (sys.includes("横版贴图")) content = JSON.stringify({ cards: [xhsDraft.cards[0]] });
    else if (user.includes("X 长文（Articles）")) content = "# X 长文标题\n\nX 长文正文";
    else if (user.includes("微信公众号文章")) content = "# 公众号标题\n\n公众号正文";
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: {} }));
  };
  const llm = new LlmGateway({ baseUrl: "http://gw", apiKey: "k", fetch: fetch as typeof globalThis.fetch, usage: { record: async () => {} } });
  return { llm, calls };
}

/** 只实现 copywriting 用到的几个查询 */
function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: async () => ({ data: [], error: null }),
    insert: (row: Record<string, unknown>) => {
      inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: `c${inserted.length}` }, error: null }) }) };
    },
  };
  return { db: { from: () => chain } as unknown as SupabaseClient, inserted };
}

describe("多形式文案生成", () => {
  it("长文排在前面：X 长文 → 公众号 → 小红书 → 其他", () => {
    const targets = ["xiaohongshu.pack", "x.thread", "wechat.article", "x.article"].map((id) => ({
      account: account(getFormat(id).platform),
      profile,
      format: getFormat(id),
    }));
    expect(orderTargets(targets).map((t) => t.format.id)).toEqual([
      "x.article",
      "wechat.article",
      "xiaohongshu.pack",
      "x.thread",
    ]);
  });

  it("公众号长文由 X 长文改写，小红书以长文为素材，各自带上发布包", async () => {
    const { llm, calls } = fakeLlm();
    const { db, inserted } = fakeDb();
    const ids = await generateContents(
      db,
      llm,
      topic,
      [
        { account: account("xiaohongshu"), profile, format: getFormat("xiaohongshu.pack") },
        { account: account("wechat"), profile, format: getFormat("wechat.article") },
        { account: account("x"), profile, format: getFormat("x.article") },
      ],
      false,
    );

    expect(ids).toHaveLength(3);
    expect(inserted.map((r) => r.variant)).toEqual([
      "x:zh-CN:article",
      "wechat:zh-CN:article",
      "xiaohongshu:zh-CN:pack",
    ]);

    const wechatCall = calls.find((c) => (c.messages[1].content as string).includes("微信公众号文章"))!;
    expect(wechatCall.messages[1].content).toContain("X 长文正文");
    const xhsCall = calls.find((c) => (c.messages[0].content as string).includes("小红书账号"))!;
    expect(xhsCall.messages[1].content).toContain("X 长文正文");

    expect(inserted[0].pack).toMatchObject({ kind: "longform", title: "X 长文标题", graphics: null });
    expect(inserted[1].pack).toMatchObject({ kind: "longform", title: "公众号标题" });
    expect((inserted[1].pack as { graphics: { meta: { width: number } } }).graphics.meta.width).toBe(1200);
    expect(inserted[2].pack).toMatchObject({ kind: "xhs", titles: ["标题"], checks: [] });
    expect((inserted[2].pack as { cards: { meta: { theme: string } } }).cards.meta.theme).toBe("tech-tutorial");
    expect(inserted[2].body).toBe("正文\n\n#AI");
    expect(inserted.every((r) => r.status === "approved")).toBe(true);
  });

  it("卡片里出现禁用词也会拦在草稿", async () => {
    const { llm } = fakeLlm();
    const { db, inserted } = fakeDb();
    xhsDraft.cards[3].title = "稳赚思路";
    await generateContents(
      db,
      llm,
      topic,
      [{ account: account("xiaohongshu"), profile, format: getFormat("xiaohongshu.pack") }],
      false,
    );
    xhsDraft.cards[3].title = "卡片标题4";
    expect(inserted[0]).toMatchObject({ status: "draft", compliance_hits: ["稳赚"] });
  });

  it("从 Markdown 取标题", () => {
    expect(titleOf("# 标题\n\n正文")).toBe("标题");
    expect(titleOf("没有标题")).toBe("");
  });
});
