import type { TranscriptSegment } from "./schema";

// Supadata：贴视频链接拿文字稿（docs.supadata.ai）。kim 的 youtube-article 插件也用它取 YouTube 字幕。
// - 有字幕直接取（1 积分）；mode=auto 时没字幕就用 AI 转写（每分钟 2 积分）；文件链接一律 AI 转写
// - 超过 20 分钟的视频返回 202 和 jobId，之后用 jobId 查结果（查询不扣积分，结果保留 1 小时）
// - 元数据（标题、作者、时长）另算 1 积分

const BASE = "https://api.supadata.ai/v1";

export interface SupadataConfig {
  apiKey: string;
  fetch?: typeof fetch;
}

/** 重试也没用的失败（没字幕、视频不公开、key 不对……），直接告诉人 */
export class SourceError extends Error {}

export type TranscriptResult =
  | { kind: "done"; segments: TranscriptSegment[]; lang: string | null }
  | { kind: "job"; jobId: string }
  | { kind: "running" };

export interface SourceMetadata {
  title: string;
  author: string;
  durationSeconds: number | null;
}

interface Chunk {
  text?: string;
  offset?: number;
  duration?: number;
  lang?: string;
}

interface TranscriptBody {
  content?: Chunk[] | string;
  lang?: string;
  status?: "queued" | "active" | "completed" | "failed";
  error?: { message?: string } | string | null;
  result?: TranscriptBody;
}

const ERRORS: Record<number, string> = {
  400: "链接不对，或者文件超过 750MB / 12 小时",
  401: "Supadata 的 API key 不对，检查 SUPADATA_API_KEY",
  402: "当前 Supadata 套餐不支持这个功能",
  403: "视频需要登录或有访问限制，转不了",
  404: "找不到这个视频，可能删了或者没公开",
};

async function call(config: SupadataConfig, path: string): Promise<Response> {
  const res = await (config.fetch ?? fetch)(`${BASE}${path}`, { headers: { "x-api-key": config.apiKey } });
  if (res.ok) return res;
  const detail = await res.text().catch(() => "");
  if (ERRORS[res.status]) throw new SourceError(ERRORS[res.status]);
  // 429（额度用完或太频繁）和 5xx 交给任务重试
  throw new Error(`Supadata 返回 ${res.status}${res.status === 429 ? "（额度用完或请求太频繁）" : ""}：${detail.slice(0, 300)}`);
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " " };

function cleanText(text: string): string {
  return text
    .replace(/&(amp|#39|quot|lt|gt|nbsp);/g, (m) => ENTITIES[m])
    .replace(/>> ?/g, "") // 自动字幕里的换人标记
    .replace(/\s+/g, " ")
    .trim();
}

/** 两段拼接：英文之间留空格，中日文直接接上 */
function join(a: string, b: string): string {
  if (!a) return b;
  return /[\x21-\x7e]$/.test(a) && /^[\x21-\x7e]/.test(b) ? `${a} ${b}` : `${a}${b}`;
}

/**
 * 字幕一条只有几秒，拼成一段一段的：到一句话结尾且够 300 字就断开，最长 600 字。
 * 页面上好读，给模型时时间戳也少很多。
 */
export function mergeChunks(chunks: Chunk[], { min = 300, max = 600 } = {}): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const chunk of chunks) {
    const text = cleanText(chunk.text ?? "");
    if (!text) continue;
    const start = Math.floor((chunk.offset ?? 0) / 1000);
    if (current && current.text.length + text.length > max) {
      segments.push(current);
      current = null;
    }
    current = current ? { start: current.start, text: join(current.text, text) } : { start, text };
    if (current.text.length >= min && /[.!?。！？…"”]$/.test(current.text)) {
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function parseDone(body: TranscriptBody): TranscriptResult {
  // 文档里查 job 的结果有的放在顶层、有的放在 result 里，两种都认
  const data = body.result ?? body;
  const chunks = Array.isArray(data.content)
    ? data.content
    : typeof data.content === "string"
      ? [{ text: data.content, offset: 0 }]
      : [];
  const segments = mergeChunks(chunks);
  if (segments.length === 0) throw new SourceError("没有识别到说话内容");
  return { kind: "done", segments, lang: data.lang ?? chunks.find((c) => c.lang)?.lang ?? null };
}

/** 发起转写。短视频直接拿到文字稿；长视频拿到 jobId，之后用 pollTranscript 查 */
export async function requestTranscript(
  config: SupadataConfig,
  url: string,
  mode: "auto" | "native",
): Promise<TranscriptResult> {
  const query = new URLSearchParams({ url, text: "false", mode });
  const res = await call(config, `/transcript?${query}`);
  if (res.status === 206) {
    throw new SourceError(
      mode === "native" ? "这个视频没有字幕。选「没字幕就 AI 转写」再试一次（按分钟计费）" : "这个视频拿不到文字稿",
    );
  }
  const body = (await res.json()) as TranscriptBody & { jobId?: string };
  if (res.status === 202 || body.jobId) {
    if (!body.jobId) throw new Error("Supadata 返回 202 但没有 jobId");
    return { kind: "job", jobId: body.jobId };
  }
  return parseDone(body);
}

export async function pollTranscript(config: SupadataConfig, jobId: string): Promise<TranscriptResult> {
  const res = await call(config, `/transcript/${encodeURIComponent(jobId)}`);
  const body = (await res.json()) as TranscriptBody;
  const status = body.status ?? body.result?.status;
  if (status === "failed") {
    const error = body.error ?? body.result?.error;
    const message = typeof error === "string" ? error : error?.message;
    throw new SourceError(`转写失败${message ? `：${message}` : ""}`);
  }
  if (status === "completed") return parseDone(body);
  return { kind: "running" };
}

/** 标题、作者、时长。文件链接没有元数据；拿不到不影响转写 */
export async function fetchMetadata(config: SupadataConfig, url: string): Promise<SourceMetadata | null> {
  try {
    const res = await call(config, `/metadata?${new URLSearchParams({ url })}`);
    const body = (await res.json()) as {
      title?: string | null;
      description?: string | null;
      author?: { displayName?: string; username?: string };
      media?: { duration?: number };
    };
    return {
      // X 帖子没有标题，用正文开头
      title: (body.title || body.description || "").replace(/\s+/g, " ").trim().slice(0, 120),
      author: body.author?.displayName || body.author?.username || "",
      durationSeconds: typeof body.media?.duration === "number" ? Math.round(body.media.duration) : null,
    };
  } catch {
    return null;
  }
}
