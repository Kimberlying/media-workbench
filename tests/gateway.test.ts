import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmGateway, type UsageRecord } from "@/lib/llm/gateway";
import { modelFor } from "@/lib/llm/models";

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

    const text = await gw.generate({ orgId: "org-1", step: "copy.x_thread", messages: [], refId: "t-1" });

    expect(text).toBe("你好");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://gw/v1/chat/completions");
    expect(JSON.parse(String(init.body)).model).toBe("grok");
    expect(records).toEqual([
      {
        org_id: "org-1",
        step: "copy.x_thread",
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

  it("环境变量可以覆盖某个环节的模型", () => {
    expect(modelFor("copy.post", '{"copy.post":"gemini-pro"}')).toBe("gemini-pro");
    expect(modelFor("copy.post", "不是 JSON")).toBe("gemini-flash");
  });
});
