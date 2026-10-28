import { describe, expect, it, vi } from "vitest";
import type { BufferContent } from "@/lib/buffer/send";
import { getFormat } from "@/lib/content/formats";
import { buildCopyPrompt } from "@/lib/pipeline/copywriting";
import { noteUrl } from "@/lib/pipeline/telegram";
import { sourceMaterial } from "@/lib/sources/digest";
import { transcribeAudio } from "@/lib/sources/gemini-audio";
import { keyboardFor, parseCallback, reviewText, splitMessage, TelegramBot } from "@/lib/telegram/bot";
import type { AccountProfile } from "@/lib/db/types";

const id = "11111111-2222-3333-4444-555555555555";

const content = (over: Partial<BufferContent> = {}): BufferContent =>
  ({
    id,
    org_id: "o",
    variant: "x:zh-CN:post",
    body: "今天把 TG 接进了工作台",
    status: "approved",
    media_urls: [],
    compliance_hits: [],
    telegram_message_id: null,
    account: { platform: "x", handle: "kim", buffer_channel_id: "ch1" },
    ...over,
  }) as BufferContent;

describe("Telegram 审核消息", () => {
  it("配了 Buffer 的给四个 Buffer 按钮，没配的（Substack）给「已手动发布」", () => {
    expect(keyboardFor(content()).flat()).toHaveLength(4);
    const substack = content({
      variant: "substack:en:article",
      account: { platform: "substack", handle: "kim", buffer_channel_id: null } as BufferContent["account"],
    });
    expect(keyboardFor(substack)).toEqual([[{ text: "已手动发布", callback_data: `bf:done:${id}` }]]);
    expect(parseCallback(`bf:done:${id}`)).toEqual({ kind: "done", contentId: id });
    expect(reviewText(substack)).toContain("复制包");
    expect(reviewText(content())).toContain("回复这条");
  });

  it("长消息按段落切，每段不超过上限，内容不丢", () => {
    const text = Array.from({ length: 30 }, (_, i) => `第 ${i} 段 ${"字".repeat(300)}`).join("\n");
    const chunks = splitMessage(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(chunks.join("\n")).toBe(text);
    expect(splitMessage("x".repeat(2500), 1000).map((c) => c.length)).toEqual([1000, 1000, 500]);
  });

  it("长文拆成几条发，按钮只在最后一条", async () => {
    const sent: { text: string; reply_markup?: unknown }[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
    });
    const bot = new TelegramBot({ token: "t", chatId: "1", fetch: fetch as unknown as typeof globalThis.fetch });
    const long = content({
      variant: "substack:en:article",
      body: Array.from({ length: 20 }, () => "word ".repeat(100)).join("\n"),
      account: { platform: "substack", handle: "kim", buffer_channel_id: null } as BufferContent["account"],
    });
    const last = await bot.sendReview(long);
    expect(sent.length).toBeGreaterThan(1);
    expect(last).toBe(sent.length);
    expect(sent.slice(0, -1).every((m) => !m.reply_markup)).toBe(true);
    expect(sent.at(-1)?.reply_markup).toBeTruthy();
  });
});

describe("Telegram 笔记进文案", () => {
  it("笔记按作者本人的观点带进提示词：带全文，不当成转述", () => {
    const material = sourceMaterial({
      platform: "telegram",
      url: noteUrl("1", 2),
      title: "",
      author: "我",
      transcript: [{ start: 0, text: "我发现 Inngest 的 step 很适合做内容流水线" }],
      digest: null,
    });
    expect(material).toContain("我发现 Inngest 的 step");
    expect(material).toContain("第一人称");
    expect(material).not.toContain("视频或播客");
  });

  it("英文账号要求全文用英文；Substack 是长文、人工发", () => {
    const profile = { positioning: "", audience: "", tone: "", taboo: [], benchmarks: [], language: "en" } as unknown as AccountProfile;
    const spec = getFormat("substack.article");
    expect(spec.kind).toBe("longform");
    expect(spec.apiPublish).toBe(false);
    const [system] = buildCopyPrompt({ title: "t", angle: "a" }, { handle: "kim" }, profile, { toneGuides: [], tabooWords: [], viralExamples: [] }, spec);
    expect(system.content).toContain("write in English");
  });
});

describe("Gemini 语音转写", () => {
  it("把音频以 inline_data 发给 Gemini，取回文字", async () => {
    let body: { contents: { parts: { inline_data?: { mime_type: string; data: string } }[] }[] } | undefined;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("gemini-test:generateContent");
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: " 转写结果 " }] } }] }));
    });
    const text = await transcribeAudio(new Uint8Array([1, 2, 3]), "audio/ogg", {
      apiKey: "k",
      model: "gemini-test",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(text).toBe("转写结果");
    expect(body?.contents[0].parts[0].inline_data).toEqual({ mime_type: "audio/ogg", data: "AQID" });
  });

  it("没转出文字时报错，不写空笔记", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [] })));
    await expect(
      transcribeAudio(new Uint8Array([1]), "audio/ogg", { apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch }),
    ).rejects.toThrow("没有转写出文字");
  });
});
