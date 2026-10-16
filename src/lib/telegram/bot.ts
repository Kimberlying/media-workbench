import { BUFFER_ACTIONS, type BufferAction } from "@/lib/buffer/client";
import type { BufferContent } from "@/lib/buffer/send";
import { countChars } from "@/lib/content/x-post";
import { formatOfVariant } from "@/lib/content/formats";

// Telegram 审核：工作台把已批准的内容推到 kim 的 TG，在 TG 里点按钮交给 Buffer。
// 按钮和 tweet-buffer-workflow 一样；「现在发送」要再点一次确认。

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
  | { kind: "back"; contentId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCallback(data: string): Callback | null {
  const [prefix, action, contentId] = data.split(":");
  if (prefix !== "bf" || !contentId || !UUID.test(contentId)) return null;
  if (action === "now?") return { kind: "confirm-now", contentId };
  if (action === "back") return { kind: "back", contentId };
  if (action in BUFFER_ACTIONS) return { kind: "send", action: action as BufferAction, contentId };
  return null;
}

/** 审核消息：平台和账号、形式、字数、图片数，然后是正文（纯文本，不用 Markdown 免得转义出错） */
export function reviewText(content: BufferContent): string {
  const lines = [
    `${content.account.platform} @${content.account.handle} · ${formatOfVariant(content.variant).label}`,
    `字符数：${countChars(content.body)}`,
  ];
  if (content.media_urls.length) lines.push(`图片：${content.media_urls.length} 张`);
  return [...lines, "", content.body].join("\n");
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

  /** 发审核消息，返回消息 id；Telegram 单条消息最多 4096 字 */
  async sendReview(content: BufferContent): Promise<number> {
    const text = reviewText(content);
    const message = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: this.config.chatId,
      text: text.length > 4096 ? `${text.slice(0, 4090)}…` : text,
      reply_markup: { inline_keyboard: reviewKeyboard(content.id) },
      link_preview_options: { is_disabled: true },
    });
    return message.message_id;
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
    await this.call("sendMessage", {
      chat_id: this.config.chatId,
      text: result,
      reply_parameters: { message_id: messageId },
    });
  }

  async answer(callbackId: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text });
  }
}
