import type { BufferContent } from "@/lib/buffer/send";
import type { ContentPack } from "@/lib/xhs/schema";
import { manualKeyboard, splitMessage, type TelegramBot } from "./bot";

// 小红书没有给个人号的发布接口，也不做浏览器自动化（封号风险）。
// 所以把发布包推到 kim 的 Telegram：卡片图成一组相册，在手机上长按存到相册或直接分享给小红书；
// 标题、正文、话题各发一条，用等宽格式，点一下（或点代码块右上角）就复制，切到小红书粘贴。
// 发完在最后一条上点「已手动发布」，工作台记为已发布。

export type XhsPack = Extract<ContentPack, { kind: "xhs" }>;

export interface PackImage {
  name: string;
  png: Uint8Array;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 话题：去掉多余的 #、空格，拼成一行「#a #b」 */
export function tagLine(tags: string[]): string {
  return tags
    .map((t) => t.trim().replace(/^#+/, "").replace(/\s+/g, ""))
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(" ");
}

/** Telegram 一组相册 2 到 10 张：按 10 张一组切，最后剩 1 张就单发 */
export function albumChunks<T>(items: T[], size = 10): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** 相册之后的几条文字消息（HTML），最后一条挂「已手动发布」按钮 */
export function packMessages(content: BufferContent, pack: XhsPack): string[] {
  const titles = pack.titles.map((t, i) => `${i + 1}. <code>${escapeHtml(t)}</code>`);
  const head = [
    `<b>小红书 @${escapeHtml(content.account.handle)} · 发布包</b>`,
    `上面是 ${pack.cards.cards.length} 张卡片，按顺序上传（第 1 张是封面）。`,
    "",
    "<b>标题</b>（点一下复制，选一个）",
    ...titles,
  ];
  if (pack.checks.length) {
    head.push("", "<b>发布前留意</b>", ...pack.checks.map((c) => `· ${escapeHtml(c)}`));
  }

  // 正文用代码块，手机上右上角有复制按钮；太长就拆成几块，按顺序复制
  const bodyChunks = splitMessage(content.body, 3500);
  const bodies = bodyChunks.map(
    (chunk, i) =>
      `<b>正文${bodyChunks.length > 1 ? `（${i + 1}/${bodyChunks.length}）` : ""}</b>\n<pre>${escapeHtml(chunk)}</pre>`,
  );

  const tags = tagLine(pack.tags);
  const tail = [
    tags ? `<b>话题</b>（点一下复制）\n<code>${escapeHtml(tags)}</code>` : "<b>话题</b>：无",
    "",
    "发完点下面的「已手动发布」。",
  ].join("\n");

  return [head.join("\n"), ...bodies, tail];
}

/** 推整个发布包，返回挂按钮那条消息的 id（存进 contents.telegram_message_id） */
export async function sendXhsPack(
  bot: TelegramBot,
  content: BufferContent,
  pack: XhsPack,
  images: PackImage[],
): Promise<number> {
  for (const chunk of albumChunks(images)) await bot.sendPhotos(chunk);
  const messages = packMessages(content, pack);
  let messageId = 0;
  for (const [i, html] of messages.entries()) {
    const last = i === messages.length - 1;
    messageId = await bot.sendHtml(html, last ? { inline_keyboard: manualKeyboard(content.id) } : undefined);
  }
  return messageId;
}
