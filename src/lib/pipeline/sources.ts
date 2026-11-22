import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { LlmGateway } from "@/lib/llm";
import type { Source } from "@/lib/db/types";
import { digestTranscript } from "@/lib/sources/digest";
import { UPLOAD_BUCKET } from "@/lib/sources/upload";
import {
  fetchMetadata,
  pollTranscript,
  requestTranscript,
  SourceError,
  type SupadataConfig,
  type TranscriptResult,
} from "@/lib/sources/supadata";

// 素材（链接转写、上传文件转写）：元数据 → 文字稿（长视频异步，等 Supadata 转完）→ 模型整理。
// 每一步都把结果写回 sources 表，任务里只传小数据。
// 没字幕、视频不公开这类重试也没用的失败直接记到 error，页面上给人看。

export function supadataFromEnv(): SupadataConfig {
  return { apiKey: requireEnv("SUPADATA_API_KEY") };
}

type SourceRow = Pick<Source, "id" | "org_id" | "url" | "platform" | "mode" | "title" | "storage_path">;

export async function loadSource(db: SupabaseClient, id: string): Promise<SourceRow> {
  const { data, error } = await db
    .from("sources")
    .select("id, org_id, url, platform, mode, title, storage_path")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as SourceRow;
}

async function update(db: SupabaseClient, id: string, patch: Partial<Source>) {
  const { error } = await db.from("sources").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markSourceFailed(db: SupabaseClient, id: string, message: string) {
  await update(db, id, { status: "failed", error: message.slice(0, 500) });
}

export async function saveMetadata(db: SupabaseClient, source: SourceRow, config: SupadataConfig) {
  if (source.platform === "file") return;
  const meta = await fetchMetadata(config, source.url);
  if (!meta) return;
  await update(db, source.id, {
    title: source.title || meta.title,
    author: meta.author,
    duration_seconds: meta.durationSeconds,
  });
}

export type TranscriptStep = { kind: "done" } | { kind: "job"; jobId: string } | { kind: "running" } | { kind: "failed" };

async function settle(db: SupabaseClient, id: string, run: () => Promise<TranscriptResult>): Promise<TranscriptStep> {
  try {
    const result = await run();
    if (result.kind !== "done") return result;
    await update(db, id, { transcript: result.segments, lang: result.lang, status: "digesting", error: null });
    return { kind: "done" };
  } catch (err) {
    if (!(err instanceof SourceError)) throw err;
    await markSourceFailed(db, id, err.message);
    return { kind: "failed" };
  }
}

/** 上传的文件给 Supadata 一个 3 小时有效的下载链接；它拿到 jobId 后就不再需要这个链接 */
async function transcribeUrl(db: SupabaseClient, source: SourceRow): Promise<string> {
  if (!source.storage_path) return source.url;
  const { data, error } = await db.storage.from(UPLOAD_BUCKET).createSignedUrl(source.storage_path, 3 * 3600);
  if (error || !data) throw new SourceError(`找不到上传的文件${error ? `：${error.message}` : ""}`);
  return data.signedUrl;
}

export async function startTranscript(db: SupabaseClient, source: SourceRow, config: SupadataConfig) {
  await update(db, source.id, { status: "transcribing", error: null });
  return settle(db, source.id, async () => requestTranscript(config, await transcribeUrl(db, source), source.mode));
}

export async function checkTranscript(db: SupabaseClient, sourceId: string, jobId: string, config: SupadataConfig) {
  return settle(db, sourceId, () => pollTranscript(config, jobId));
}

export async function digestSource(db: SupabaseClient, llm: LlmGateway, sourceId: string) {
  const { data, error } = await db
    .from("sources")
    .select("id, org_id, url, title, author, duration_seconds, transcript")
    .eq("id", sourceId)
    .single();
  if (error) throw new Error(error.message);
  const source = data as Pick<Source, "id" | "org_id" | "url" | "title" | "author" | "duration_seconds" | "transcript">;
  const digest = await digestTranscript(llm, {
    orgId: source.org_id,
    sourceId: source.id,
    meta: source,
    segments: source.transcript ?? [],
  });
  await update(db, source.id, { digest, title: source.title || digest.title, status: "ready", error: null });
  return { chapters: digest.chapters.length, angles: digest.angles.length };
}
