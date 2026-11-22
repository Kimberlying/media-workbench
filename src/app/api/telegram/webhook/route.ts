import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { BufferRejected } from "@/lib/buffer/client";
import { canSendToBuffer, sendToBuffer, type BufferContent } from "@/lib/buffer/send";
import { formatOfVariant } from "@/lib/content/formats";
import { checkXPost } from "@/lib/content/x-post";
import { requireEnv } from "@/lib/env";
import { EVENTS, inngest } from "@/inngest/client";
import { replaceImage } from "@/lib/media/image";
import { saveNote } from "@/lib/pipeline/telegram";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmNowKeyboard, parseCallback, reviewKeyboard, TelegramBot } from "@/lib/telegram/bot";

// Telegram 的 webhook，只认 setWebhook 时设的 secret_token 和 TELEGRAM_CHAT_ID 这个对话：
// - 发文字或语音：存成笔记，后台写成 X、Substack、LinkedIn 三份推回来审核
// - 回复某条审核消息：用回复的文字替换那条内容的正文，重新推一条审核消息；回复一张图就换配图
// - 点审核消息上的按钮：交给 Buffer，或登记已手动发布。点按钮就算批准
// 总是回 200，免得 Telegram 重投；重复的消息和点击也会被唯一索引挡住。

type Db = ReturnType<typeof createAdminClient>;

interface Message {
  message_id: number;
  chat: { id: number };
  text?: string;
  voice?: { file_id: string; mime_type?: string; duration?: number };
  audio?: { file_id: string; mime_type?: string; duration?: number };
  /** 同一张图的几种尺寸，最后一个最大 */
  photo?: { file_id: string }[];
  /** 当文件发的图（不压缩） */
  document?: { file_id: string; mime_type?: string };
  reply_to_message?: { message_id: number };
}

interface Update {
  message?: Message;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

const HELP =
  "发一段文字或语音给我，我会整理观点，写成 X 中文短推、Substack 英文长文和 LinkedIn 英文帖，逐条发回来给你审。\n" +
  "要改某条，直接回复那条消息，发改好的全文。";

function authorized(header: string | null): boolean {
  const expected = Buffer.from(requireEnv("TELEGRAM_WEBHOOK_SECRET"));
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const update = (await request.json()) as Update;
  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const bot = new TelegramBot({ token: requireEnv("TELEGRAM_BOT_TOKEN"), chatId });
  const db = createAdminClient();

  if (update.message) {
    // 别的对话发来的一律不理
    if (String(update.message.chat.id) === chatId) await onMessage(db, bot, chatId, update.message);
    return new Response("ok");
  }
  if (update.callback_query) await onCallback(db, bot, chatId, update.callback_query);
  return new Response("ok");
}

async function loadContent(db: Db, filter: { id: string } | { telegram_message_id: number }) {
  const [key, value] = Object.entries(filter)[0];
  const { data } = await db.from("contents").select("*, account:accounts(*)").eq(key, value).maybeSingle();
  return data as BufferContent | null;
}

async function onMessage(db: Db, bot: TelegramBot, chatId: string, message: Message) {
  const text = message.text?.trim();
  if (text?.startsWith("/")) {
    await bot.send(HELP, undefined, message.message_id);
    return;
  }

  const picture = message.photo?.at(-1)?.file_id ??
    (message.document?.mime_type?.startsWith("image/") ? message.document.file_id : undefined);
  if (message.reply_to_message && (text || picture)) {
    const content = await loadContent(db, { telegram_message_id: message.reply_to_message.message_id });
    if (content && picture) {
      await swapImage(db, bot, content, picture, message.document?.mime_type, message.message_id);
      return;
    }
    if (content && text) {
      await editContent(db, bot, content, text, message.message_id);
      return;
    }
  }
  if (picture) {
    await bot.send("要换配图的话，回复那条稿子发这张图。", undefined, message.message_id);
    return;
  }

  const audio = message.voice ?? message.audio;
  if (!text && !audio) {
    await bot.send("现在只认文字和语音。", undefined, message.message_id);
    return;
  }
  const voice = audio ? { fileId: audio.file_id, mimeType: audio.mime_type || "audio/ogg" } : undefined;
  const sourceId = await saveNote(db, {
    chatId,
    messageId: message.message_id,
    text,
    voice: voice && { ...voice, duration: audio?.duration },
  });
  if (!sourceId) return;
  await inngest.send({ name: EVENTS.telegramNote, data: { sourceId, messageId: message.message_id, voice } });
  await bot.send(
    voice ? "收到语音，转写整理后写成三份发回来。" : "收到，整理后写成三份发回来。",
    undefined,
    message.message_id,
  );
  revalidatePath("/sources");
}

/** 回复审核消息 = 改正文。只改短内容（长文在工作台里改），已交出去的不改 */
async function editContent(db: Db, bot: TelegramBot, content: BufferContent, body: string, replyTo: number) {
  const format = formatOfVariant(content.variant);
  if (format.kind !== "text") {
    await bot.send("长文请到工作台「内容」里改，改完点「推到 Telegram」。", undefined, replyTo);
    return;
  }
  if (!["draft", "pending_approval", "approved"].includes(content.status)) {
    await bot.send("这条已经交给 Buffer 或发出去了，不能再改。", undefined, replyTo);
    return;
  }
  const pack = content.pack?.kind === "post" ? { ...content.pack, checks: checkXPost(body) } : content.pack;
  const { error } = await db.from("contents").update({ body, pack }).eq("id", content.id);
  if (error) throw new Error(error.message);

  // 旧消息的按钮去掉，改好的重新推一条，按钮只认新的
  await bot.setKeyboard(content.telegram_message_id!, []);
  const messageId = await bot.sendReview({ ...content, body, pack });
  await db.from("contents").update({ telegram_message_id: messageId }).eq("id", content.id);
  revalidatePath("/contents");
}

/** 回复一张图 = 换配图（比如在 ChatGPT 里做的）：同一篇的稿子都换上，重新推这一条 */
async function swapImage(
  db: Db,
  bot: TelegramBot,
  content: BufferContent,
  fileId: string,
  mimeType: string | undefined,
  replyTo: number,
) {
  if (!["draft", "pending_approval", "approved"].includes(content.status)) {
    await bot.send("这条已经交给 Buffer 或发出去了，换不了图。", undefined, replyTo);
    return;
  }
  const bytes = await bot.download(fileId);
  const { url, count } = await replaceImage(db, content, { bytes, mimeType: mimeType || "image/jpeg" });
  await bot.setKeyboard(content.telegram_message_id!, []);
  const fresh = { ...content, media_urls: [url, ...content.media_urls.slice(1)] };
  const messageId = await bot.sendReview(fresh);
  await db.from("contents").update({ telegram_message_id: messageId }).eq("id", content.id);
  if (count > 1) await bot.send(`同一篇的 ${count} 条稿子都换成了这张图，交给 Buffer 时会带上。`, undefined, messageId);
  revalidatePath("/contents");
}

/** 在 TG 里点按钮就算审过了：待审批的直接批准 */
async function approve(db: Db, content: BufferContent): Promise<string | null> {
  if (content.status === "approved") return null;
  if (content.status !== "pending_approval") {
    return content.status === "draft" ? "这条停在草稿（命中禁用词），到工作台改" : "这条已经交出去了";
  }
  const { error } = await db
    .from("contents")
    .update({ status: "approved" })
    .eq("id", content.id)
    .eq("status", "pending_approval");
  if (error) return error.message;
  content.status = "approved";
  return null;
}

async function onCallback(db: Db, bot: TelegramBot, chatId: string, query: NonNullable<Update["callback_query"]>) {
  const message = query.message;
  if (!message) return;
  const callback = parseCallback(query.data ?? "");
  if (String(message.chat.id) !== chatId || !callback) {
    await bot.answer(query.id, "这个按钮不归这里处理");
    return;
  }

  const content = await loadContent(db, { id: callback.contentId });
  if (!content || content.telegram_message_id !== message.message_id) {
    await bot.answer(query.id, "找不到这条内容，或它已经重新推送过");
    return;
  }

  if (callback.kind === "confirm-now") {
    await bot.setKeyboard(message.message_id, confirmNowKeyboard(content.id));
    await bot.answer(query.id);
    return;
  }
  if (callback.kind === "back") {
    await bot.setKeyboard(message.message_id, reviewKeyboard(content.id));
    await bot.answer(query.id);
    return;
  }

  const problem = await approve(db, content);
  if (problem) {
    await bot.answer(query.id, problem);
    return;
  }

  if (callback.kind === "done") {
    const { data: moved } = await db
      .from("contents")
      .update({ status: "published" })
      .eq("id", content.id)
      .eq("status", "approved")
      .select("id")
      .maybeSingle();
    if (moved) {
      await db.from("posts").insert({ org_id: content.org_id, content_id: content.id, method: "manual" });
    }
    await bot.answer(query.id, "已登记为发布");
    await bot.finish(message.message_id, "已登记为手动发布。");
    revalidatePath("/contents");
    return;
  }

  if (!canSendToBuffer(content)) {
    await bot.answer(query.id, "这个账号没配 Buffer 频道");
    return;
  }
  try {
    const result = await sendToBuffer(db, content, callback.action);
    await bot.answer(query.id, result.summary);
    await bot.finish(message.message_id, result.summary);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof BufferRejected) {
      // 明确没发出去：按钮留着，改了可以再点
      await bot.answer(query.id, `没有交给 Buffer：${reason}`);
    } else {
      await bot.answer(query.id, "结果不确定");
      await bot.finish(
        message.message_id,
        `结果不确定，工作台不会重发：${reason}\n请到 Buffer 看看有没有这条，再到工作台「内容」里登记。`,
      );
    }
  }
  revalidatePath("/contents");
}
