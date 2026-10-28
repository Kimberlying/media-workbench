import { BUFFER_ACTIONS, type BufferAction } from "@/lib/buffer/client";
import { canSendToBuffer, type BufferContent } from "@/lib/buffer/send";
import { countChars } from "@/lib/content/x-post";
import { formatOfVariant } from "@/lib/content/formats";

// Telegram 审核：内容推到 kim 的 TG，在 TG 里点按钮交给 Buffer。
// 按钮和 tweet-buffer-workflow 一样；「现在发送」要再点一次确认。
// 没配 Buffer 频道的（Substack 长文等）发复制包，复制贴到平台后点「已手动发布」。

const API = "https://api.telegram.org";

export interface TelegramConfig {
  token: string;
  chatId: string;
  fetch?: typeof fetch;
}

type Button = { text: string; callback_data: string };

// callback_data 最多 64 字节：前缀 + 内容 uuid
export function reviewKeyboard(contentId: string): Button[][] {
  return [
    [
      { text: BUFFER_ACTIONS.draft, callback_data: `bf:draft:${contentId}` },
      { text: BUFFER_ACTIONS.queue, callback_data: `bf:queue:${contentId}` },
    ],
    [
      { text: BUFFER_ACTIONS.top, callback_data: `bf:top:${contentId}` },
      { text: BUFFER_ACTIONS.now, callback_data: `bf:now?:${contentId}` },
    ],
  ];
}

export function manualKeyboard(contentId: string): Button[][] {
  return [[{ text: "已手动发布", callback_data: `bf:done:${contentId}` }]];
}

export function keyboardFor(content: BufferContent): Button[][] {
  return canSendToBuffer(content) ? reviewKeyboard(content.id) : manualKeyboard(content.id);
}

export function confirmNowKeyboard(contentId: string): Button[][] {
  return [
    [
      { text: "确认现在发送", callback_data: `bf:now:${contentId}` },
      { text: "返回", callback_data: `bf:back:${contentId}` },
    ],
  ];
}

export type Callback =
  | { kind: "send"; action: BufferAction; contentId: string }
  | { kind: "confirm-now"; contentId: string }
  | { kind: "back"; contentId: string }
  | { kind: "done"; contentId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCallback(data: string): Callback | null {
  const [prefix, action, contentId] = data.split(":");
  if (prefix !== "bf" || !contentId || !UUID.test(contentId)) return null;
  if (action === "now?") return { kind: "confirm-now", contentId };
  if (action === "back") return { kind: "back", contentId };
  if (action === "done") return { kind: "done", contentId };
  if (action in BUFFER_ACTIONS) return { kind: "send", action: action as BufferAction, contentId };
  return null;
}

/** 审核消息：平台和账号、形式、字数、图片数，然后是正文（纯文本，不用 Markdown 免得转义出错） */
export function reviewText(content: BufferContent): string {
  const format = formatOfVariant(content.variant);
  const lines = [`${content.account.platform} @${content.account.handle} · ${format.label}`];
  if (format.kind === "text") {
    lines.push(`字符数：${countChars(content.body)}`);
    if (content.media_urls.length) lines.push(`图片：${content.media_urls.length} 张`);
    lines.push(canSendToBuffer(content) ? "要改就直接回复这条，发改好的全文" : "没配 Buffer 频道：复制去发，发完点「已手动发布」");
  } else {
    lines.push("复制包：复制下面的全文贴进编辑器（标题在第一行），发完点「已手动发布」");
  }
  return [...lines, "", content.body].join("\n");
}

/** Telegram 单条消息最多 4096 字：按段落切，切不开的长段落硬切 */
export function splitMessage(text: string, max = 4000): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const para of text.split("\n")) {
    let rest = para;
    while (rest.length > max) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    const next = current ? `${current}\n${rest}` : rest;
    if (next.length > max) {
      chunks.push(current);
      current = rest;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export class TelegramBot {
  constructor(private readonly config: TelegramConfig) {}

  private async call<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const res = await (this.config.fetch ?? fetch)(`${API}/bot${this.config.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!body.ok) throw new Error(`Telegram ${method} 失败：${body.description ?? res.status}`);
    return body.result as T;
  }

  /** 发审核消息，返回带按钮的那条消息的 id；长文拆成几条，按钮在最后一条 */
  async sendReview(content: BufferContent): Promise<number> {
    const chunks = splitMessage(reviewText(content));
    let messageId = 0;
    for (const [i, text] of chunks.entries()) {
      const last = i === chunks.length - 1;
      messageId = await this.send(text, last ? { inline_keyboard: keyboardFor(content) } : undefined);
    }
    return messageId;
  }

  async send(text: string, replyMarkup?: { inline_keyboard: Button[][] }, replyTo?: number): Promise<number> {
    const message = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: this.config.chatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
    });
    return message.message_id;
  }

  /** 下载用户发来的文件（语音）；机器人最多能下 20MB */
  async download(fileId: string): Promise<Uint8Array> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new Error("Telegram 没有给出文件地址，文件可能超过 20MB");
    const res = await (this.config.fetch ?? fetch)(`${API}/file/bot${this.config.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`下载 Telegram 文件失败（${res.status}）`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async setKeyboard(messageId: number, keyboard: Button[][]): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: this.config.chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  /** 去掉按钮并在原消息下回一句结果，防止同一条再被点 */
  async finish(messageId: number, result: string): Promise<void> {
    await this.setKeyboard(messageId, []);
    await this.send(result, undefined, messageId);
  }

  async answer(callbackId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text });
  }
}
