import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BufferClient } from "@/lib/buffer/client";
import { LlmGateway, type UsageRecord } from "@/lib/llm/gateway";
import { directProviders } from "@/lib/llm/providers";

// 上线前用真 key 核对模型和 Buffer：npm run check:models（读 .env.local，会花几分钱；Buffer 只读频道，不发帖）。
// 平时 npm test 不带 LIVE=1，这里整组跳过。

const live = process.env.LIVE === "1";
if (live && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!live)("真实模型接口", () => {
  const records: UsageRecord[] = [];
  const providers = live ? directProviders() : {};
  const gw = new LlmGateway({
    providers,
    usage: { record: async (u) => void records.push(u) },
    xai: process.env.XAI_API_KEY
      ? { apiKey: process.env.XAI_API_KEY, model: process.env.XAI_MODEL || "grok-4.7" }
      : undefined,
  });

  it.each(["grok", "gemini-flash"])("%s 能按 JSON 模式返回", { timeout: 60_000 }, async (alias) => {
    expect(providers[alias], `没配 ${alias} 的 key`).toBeDefined();
    const out = await gw.generate({
      orgId: null,
      step: "copy.post",
      model: alias,
      messages: [{ role: "user", content: '只回 JSON：{"ok": true}' }],
      json: z.object({ ok: z.boolean() }),
    });
    expect(out.ok).toBe(true);
  });

  it("Grok 能用 x_search 搜到最近的 X 帖子", { timeout: 180_000 }, async () => {
    expect(process.env.XAI_API_KEY, "没配 XAI_API_KEY").toBeTruthy();
    const today = new Date();
    const from = new Date(today.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const text = await gw.generate({
      orgId: null,
      step: "radar.x",
      messages: [{ role: "user", content: "列出 3 条最近关于 AI 产品的热门 X 帖子，每条一行，带链接。" }],
      tools: [{ type: "x_search", from_date: from }],
    });
    expect(text).toMatch(/x\.com|twitter\.com/);
    console.log(text, records);
  });
});

describe.skipIf(!live || !process.env.BUFFER_API_KEY)("Buffer 接口", () => {
  it("能列出频道", { timeout: 30_000 }, async () => {
    const channels = await new BufferClient(process.env.BUFFER_API_KEY!).channels();
    console.log(channels);
    expect(channels.length).toBeGreaterThan(0);
  });
});
