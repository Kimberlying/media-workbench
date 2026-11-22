import { describe, expect, it, vi } from "vitest";
import type { BufferContent } from "@/lib/buffer/send";
import { TelegramBot } from "@/lib/telegram/bot";
import { albumChunks, escapeHtml, packMessages, sendXhsPack, tagLine, type XhsPack } from "@/lib/telegram/xhs";

const pack = {
  kind: "xhs",
  brief: {},
  cards: {
    meta: { title: "t", width: 1080, height: 1800, theme: "warm", footer: "" },
    cards: Array.from({ length: 3 }, (_, i) => ({ file: `0${i + 1}.png`, layout: "list", title: `卡${i + 1}` })),
  },
  titles: ["AI 工作流 <3 步>", "第二个标题"],
  tags: ["#AI工具", "效率 提升", ""],
  source_notes: "",
  checks: ["数据要核对"],
} as unknown as XhsPack;

const content = {
  id: "11111111-2222-3333-4444-555555555555",
  variant: "xiaohongshu:zh-CN:pack",
  body: "第一段 & 说明\n第二段",
  status: "approved",
  account: { platform: "xiaohongshu", handle: "kim" },
} as unknown as BufferContent;

describe("小红书发布包推到 Telegram", () => {
  it("话题拼成一行，去掉重复的 # 和空格", () => {
    expect(tagLine(pack.tags)).toBe("#AI工具 #效率提升");
  });

  it("相册按 10 张一组切", () => {
    expect(albumChunks(Array.from({ length: 23 }, (_, i) => i)).map((c) => c.length)).toEqual([10, 10, 3]);
  });

  it("标题、正文、话题分开发，可点击复制，HTML 转义", () => {
    const [head, body, tail] = packMessages(content, pack);
    expect(head).toContain(`<code>${escapeHtml("AI 工作流 <3 步>")}</code>`);
    expect(head).toContain("数据要核对");
    expect(body).toContain("<pre>第一段 &amp; 说明\n第二段</pre>");
    expect(tail).toContain("<code>#AI工具 #效率提升</code>");
  });

  it("先发相册，再发文字，按钮挂在最后一条", async () => {
    const calls: { method: string; body: unknown }[] = [];
    let id = 100;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const method = url.split("/").pop()!;
      calls.push({ method, body: init.body instanceof FormData ? init.body : JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: ++id } }));
    });
    const bot = new TelegramBot({ token: "t", chatId: "1", fetch: fetch as unknown as typeof globalThis.fetch });
    const images = pack.cards.cards.map((c) => ({ name: c.file, png: new Uint8Array([1, 2, 3]) }));
    const messageId = await sendXhsPack(bot, content, pack, images);

    expect(calls.map((c) => c.method)).toEqual(["sendMediaGroup", "sendMessage", "sendMessage", "sendMessage"]);
    const form = calls[0].body as FormData;
    expect(JSON.parse(String(form.get("media")))).toHaveLength(3);
    expect(form.get("p2")).toBeInstanceOf(Blob);
    const last = calls[3].body as { parse_mode: string; reply_markup: { inline_keyboard: { callback_data: string }[][] } };
    expect(last.parse_mode).toBe("HTML");
    expect(last.reply_markup.inline_keyboard[0][0].callback_data).toBe(`bf:done:${content.id}`);
    expect(messageId).toBe(104);
  });

  it("只有一张图时用 sendPhoto", async () => {
    const methods: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      methods.push(url.split("/").pop()!);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    });
    const bot = new TelegramBot({ token: "t", chatId: "1", fetch: fetch as unknown as typeof globalThis.fetch });
    await bot.sendPhotos([{ name: "01.png", png: new Uint8Array([1]) }]);
    expect(methods).toEqual(["sendPhoto"]);
  });
});
