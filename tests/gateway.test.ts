import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmGateway, type UsageRecord } from "@/lib/llm/gateway";
import { costOf, modelFor } from "@/lib/llm/models";
import { directProviders } from "@/lib/llm/providers";

function fakeFetch(content: string, cost = "0.0012") {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      }),
      { headers: { "x-litellm-response-cost": cost } },
    ),
  );
}

describe("模型网关", () => {
  it("按环节选模型，并记录用量和费用", async () => {
    const records: UsageRecord[] = [];
    const fetch = fakeFetch("你好");
    const gw = new LlmGateway({
      baseUrl: "http://gw/",
      apiKey: "k",
      fetch,
      usage: { record: async (u) => void records.push(u) },
    });

    const text = await gw.generate({ orgId: "org-1", step: "radar.x", messages: [], refId: "t-1" });

    expect(text).toBe("你好");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gw/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("grok");
    expect(records).toEqual([
      {
        org_id: "org-1",
        step: "radar.x",
        model: "grok",
        input_tokens: 100,
        output_tokens: 40,
        cost: 0.0012,
        ref_id: "t-1",
      },
    ]);
  });

  it("要求 JSON 时按 schema 解析，容忍代码块包裹", async () => {
    const gw = new LlmGateway({
      baseUrl: "http://gw",
      apiKey: "k",
      fetch: fakeFetch('```json\n{"n": 3}\n```'),
      usage: { record: async () => {} },
    });
    const out = await gw.generate({
      orgId: null,
      step: "topics.plan",
      messages: [],
      json: z.object({ n: z.number() }),
    });
    expect(out).toEqual({ n: 3 });
  });

  it("带工具时走 Responses 接口，拼出文本并记录用量", async () => {
    const records: UsageRecord[] = [];
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: [
            { type: "x_search_call" },
            { type: "message", content: [{ type: "output_text", text: '{"n":' }, { type: "output_text", text: " 2}" }] },
          ],
          usage: { input_tokens: 50, output_tokens: 10 },
        }),
      ),
    );
    const gw = new LlmGateway({
      baseUrl: "http://gw",
      apiKey: "k",
      fetch,
      usage: { record: async (u) => void records.push(u) },
    });
    const tool = { type: "x_search", from_date: "2026-10-12", to_date: "2026-10-14" };
    const out = await gw.generate({
      orgId: null,
      step: "radar.x",
      messages: [{ role: "user", content: "找热点" }],
      tools: [tool],
      json: z.object({ n: z.number() }),
    });

    expect(out).toEqual({ n: 2 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gw/v1/responses");
    const body = JSON.parse(String(init.body));
    expect(body.input).toEqual([{ role: "user", content: "找热点" }]);
    expect(body.tools).toEqual([tool]);
    expect(body.response_format).toBeUndefined();
    expect(records[0]).toMatchObject({ step: "radar.x", model: "grok", input_tokens: 50, output_tokens: 10 });
  });

  it("配了 xAI 时，带工具的请求直连 xAI；普通请求仍走网关", async () => {
    const records: UsageRecord[] = [];
    const fetch = vi.fn(async (url: string) =>
      url.includes("x.ai")
        ? new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] }))
        : new Response(JSON.stringify({ choices: [{ message: { content: "gw" } }] })),
    );
    const gw = new LlmGateway({
      baseUrl: "http://gw",
      apiKey: "gw-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
      usage: { record: async (u) => void records.push(u) },
      xai: { apiKey: "xai-key", model: "grok-4.7" },
    });

    expect(await gw.generate({ orgId: null, step: "radar.x", messages: [], tools: [{ type: "x_search" }] })).toBe("ok");
    expect(await gw.generate({ orgId: null, step: "copy.post", messages: [] })).toBe("gw");

    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.x.ai/v1/responses");
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe("Bearer xai-key");
    expect(JSON.parse(String(calls[0][1].body)).model).toBe("grok-4.7");
    expect(calls[1][0]).toBe("http://gw/v1/chat/completions");
    expect(records.map((r) => r.model)).toEqual(["grok-4.7", "gemini-flash"]);
  });

  it("没配 LiteLLM 时按别名直连各家，并按单价算费用", async () => {
    const records: UsageRecord[] = [];
    const fetch = fakeFetch("直连", "");
    const gw = new LlmGateway({
      fetch,
      usage: { record: async (u) => void records.push(u) },
      providers: directProviders({ XAI_API_KEY: "xai-key", GEMINI_API_KEY: "g-key" }),
    });

    await gw.generate({ orgId: null, step: "radar.x", messages: [] });
    await gw.generate({ orgId: null, step: "copy.post", messages: [] });

    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://api.x.ai/v1/chat/completions");
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe("Bearer xai-key");
    expect(calls[1][0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(JSON.parse(String(calls[1][1].body)).model).toBe("gemini-3.8-flash");
    expect(records.map((r) => r.model)).toEqual(["grok-4.7", "gemini-3.8-flash"]);
    expect(records[0].cost).toBeCloseTo((100 * 2 + 40 * 6) / 1_000_000);
  });

  it("别名既没有直连 key 也没有 LiteLLM 时报错说清缺什么", async () => {
    const gw = new LlmGateway({ usage: { record: async () => {} }, providers: directProviders({ XAI_API_KEY: "k" }) });
    await expect(gw.generate({ orgId: null, step: "copy.post", messages: [] })).rejects.toThrow("gemini-flash");
  });

  it("没列单价的模型费用记 0", () => {
    expect(costOf("grok", 1000, 1000)).toBe(0);
  });

  it("环境变量可以覆盖某个环节的模型", () => {
    expect(modelFor("copy.post", '{"copy.post":"gemini-pro"}')).toBe("gemini-pro");
    expect(modelFor("copy.post", "不是 JSON")).toBe("gemini-flash");
  });

  it("工作台里填的模型 ID 按组织覆盖直连的默认模型", async () => {
    const records: UsageRecord[] = [];
    const fetch = fakeFetch("好", "");
    const modelIds = vi.fn(async (orgId: string | null) => (orgId === "org-1" ? { "gemini-flash": "gemini-4.0-flash" } : {}));
    const gw = new LlmGateway({
      fetch,
      usage: { record: async (u) => void records.push(u) },
      providers: directProviders({ GEMINI_API_KEY: "g" }),
      modelIds,
    });
    await gw.generate({ orgId: "org-1", step: "copy.post", messages: [] });
    await gw.generate({ orgId: "org-2", step: "copy.post", messages: [] });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[0][1].body)).model).toBe("gemini-4.0-flash");
    expect(JSON.parse(String(calls[1][1].body)).model).toBe("gemini-3.8-flash");
    expect(records.map((r) => r.model)).toEqual(["gemini-4.0-flash", "gemini-3.8-flash"]);
  });
});
