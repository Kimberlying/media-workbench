import type { SupabaseClient } from "@supabase/supabase-js";
import { formatOfVariant, getFormat } from "@/lib/content/formats";
import type { Account, AccountProfile, Platform, Source, Topic } from "@/lib/db/types";
import { transcribeAudio } from "@/lib/sources/gemini-audio";
import type { TelegramBot } from "@/lib/telegram/bot";
import type { BufferContent } from "@/lib/buffer/send";

// Telegram 当输入端：kim 给机器人发一段文字或语音 → 存成一条素材 → （语音先转写）→ 整理观点
// → 按「技术博主」模板写 X 中文短推、Substack 英文长文、LinkedIn 英文帖 → 每条推回 TG 审核。
// 素材用 sources 表，和「素材」页的视频转写是同一套，写文案时按作者本人的笔记带进提示词。

/** 技术博主模板：每个平台写哪种形式。账号在「账号与档案」里一键建好 */
export const CREATOR_FORMATS: Partial<Record<Platform, string>> = {
  x: "x.post",
  substack: "substack.article",
  linkedin: "linkedin.post",
};

export interface IncomingNote {
  chatId: string;
  messageId: number;
  text?: string;
  voice?: { fileId: string; mimeType: string; duration?: number };
}

export function noteUrl(chatId: string, messageId: number): string {
  return `telegram:${chatId}/${messageId}`;
}

/** 自用工作台只有一个组织：笔记记到最早建的那个工作区 */
async function defaultWorkspace(db: SupabaseClient): Promise<{ id: string; org_id: string }> {
  const { data, error } = await db
    .from("workspaces")
    .select("id, org_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("还没有工作区：先打开工作台用邮箱登录一次");
  return data;
}

/** 存成素材，返回素材 id；Telegram 重投同一条消息时返回 null，不重复处理 */
export async function saveNote(db: SupabaseClient, note: IncomingNote): Promise<string | null> {
  const url = noteUrl(note.chatId, note.messageId);
  const { data: existing } = await db.from("sources").select("id").eq("url", url).limit(1).maybeSingle();
  if (existing) return null;

  const workspace = await defaultWorkspace(db);
  const text = note.text?.trim() ?? "";
  const { data, error } = await db
    .from("sources")
    .insert({
      org_id: workspace.org_id,
      workspace_id: workspace.id,
      url,
      platform: "telegram",
      title: text ? text.split("\n")[0].slice(0, 60) : "Telegram 语音",
      author: "我",
      duration_seconds: note.voice?.duration ?? null,
      status: text ? "digesting" : "transcribing",
      transcript: text ? [{ start: 0, text }] : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function transcribeNote(
  db: SupabaseClient,
  bot: TelegramBot,
  sourceId: string,
  voice: { fileId: string; mimeType: string },
  gemini: { apiKey: string; model?: string },
): Promise<number> {
  const audio = await bot.download(voice.fileId);
  const text = await transcribeAudio(audio, voice.mimeType, gemini);
  const { error } = await db
    .from("sources")
    .update({ transcript: [{ start: 0, text }], title: text.split("\n")[0].slice(0, 60), status: "digesting" })
    .eq("id", sourceId);
  if (error) throw new Error(error.message);
  return text.length;
}

export interface NotePlan {
  topic: Topic;
  targets: { account: Account; profile: AccountProfile; formatId: string }[];
}

/** 整理好的笔记 → 一个选题 + 模板里有档案的账号；一个账号都没有时返回 null */
export async function planNote(db: SupabaseClient, sourceId: string): Promise<NotePlan | null> {
  const { data: source, error } = await db
    .from("sources")
    .select("id, org_id, workspace_id, title, digest")
    .eq("id", sourceId)
    .single();
  if (error) throw new Error(error.message);
  const { org_id, workspace_id, title, digest } = source as Pick<
    Source,
    "id" | "org_id" | "workspace_id" | "title" | "digest"
  >;

  const { data: rows, error: accError } = await db
    .from("accounts")
    .select("*, profile:account_profiles(*)")
    .eq("workspace_id", workspace_id)
    .in("platform", Object.keys(CREATOR_FORMATS))
    .order("created_at", { ascending: true });
  if (accError) throw new Error(accError.message);
  const seen = new Set<string>();
  const targets = (rows ?? []).flatMap((row) => {
    const { profile, ...account } = row as Account & { profile: AccountProfile | null };
    // 每个平台只写一个账号（最早建的那个）
    if (!profile || seen.has(account.platform)) return [];
    seen.add(account.platform);
    return [{ account: account as Account, profile, formatId: getFormat(CREATOR_FORMATS[account.platform]!).id }];
  });
  if (targets.length === 0) return null;

  const angle = digest?.angles[0];
  const { data: topic, error: topicError } = await db
    .from("topics")
    .insert({
      org_id,
      account_id: targets[0].account.id,
      source_id: sourceId,
      title: angle?.title || digest?.title || title,
      angle: angle?.angle || digest?.summary || "",
      status: "selected",
    })
    .select("*")
    .single();
  if (topicError) throw new Error(topicError.message);
  return { topic: topic as Topic, targets };
}

/** 生成好的内容逐条推到 TG 审核，记下带按钮的消息 id（按钮只认这条） */
export async function sendReviews(db: SupabaseClient, bot: TelegramBot, contentIds: string[]): Promise<number> {
  const { data, error } = await db.from("contents").select("*, account:accounts(*)").in("id", contentIds);
  if (error) throw new Error(error.message);
  const contents = (data ?? []) as BufferContent[];
  // 短内容在前（X、LinkedIn），长文复制包放最后
  const rank = (c: BufferContent) => (formatOfVariant(c.variant).kind === "text" ? 0 : 1);
  contents.sort((a, b) => rank(a) - rank(b));
  for (const content of contents) {
    if (content.compliance_hits.length) {
      await bot.send(
        `${content.account.platform} @${content.account.handle}：命中禁用词「${content.compliance_hits.join("、")}」，停在草稿，到工作台「内容」里改。`,
      );
      continue;
    }
    const messageId = await bot.sendReview(content);
    const { error: updateError } = await db
      .from("contents")
      .update({ telegram_message_id: messageId })
      .eq("id", content.id);
    if (updateError) throw new Error(updateError.message);
  }
  return contents.length;
}
