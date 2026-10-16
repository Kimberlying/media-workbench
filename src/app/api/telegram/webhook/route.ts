import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { BufferRejected } from "@/lib/buffer/client";
import { sendToBuffer, type BufferContent } from "@/lib/buffer/send";
import { requireEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmNowKeyboard, parseCallback, reviewKeyboard, TelegramBot } from "@/lib/telegram/bot";

// Telegram 的 webhook：处理审核消息上的按钮。
// 只认 setWebhook 时设的 secret_token、TELEGRAM_CHAT_ID 这个对话，以及工作台推过去的那条消息。
// 总是回 200，免得 Telegram 重投同一个点击；重复点击也会被发布记录的唯一索引挡住。

interface Update {
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

function authorized(header: string | null): boolean {
  const expected = Buffer.from(requireEnv("TELEGRAM_WEBHOOK_SECRET"));
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("unauthorized", { status: 401 });
  }
  const query = ((await request.json()) as Update).callback_query;
  const message = query?.message;
  if (!query || !message) return new Response("ok");

  const chatId = requireEnv("TELEGRAM_CHAT_ID");
  const bot = new TelegramBot({ token: requireEnv("TELEGRAM_BOT_TOKEN"), chatId });
  const callback = parseCallback(query.data ?? "");
  if (String(message.chat.id) !== chatId || !callback) {
    await bot.answer(query.id, "这个按钮不归这里处理");
    return new Response("ok");
  }

  const db = createAdminClient();
  const { data } = await db
    .from("contents")
    .select("*, account:accounts(*)")
    .eq("id", callback.contentId)
    .maybeSingle();
  const content = data as BufferContent | null;
  if (!content || content.telegram_message_id !== message.message_id) {
    await bot.answer(query.id, "找不到这条内容，或它已经重新推送过");
    return new Response("ok");
  }

  if (callback.kind === "confirm-now") {
    await bot.setKeyboard(message.message_id, confirmNowKeyboard(content.id));
    await bot.answer(query.id);
    return new Response("ok");
  }
  if (callback.kind === "back") {
    await bot.setKeyboard(message.message_id, reviewKeyboard(content.id));
    await bot.answer(query.id);
    return new Response("ok");
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
  return new Response("ok");
}
