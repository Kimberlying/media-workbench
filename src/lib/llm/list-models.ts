import Anthropic from "@anthropic-ai/sdk";
import { PROVIDERS, type ProviderId } from "./catalog";

// 「模型」页的下拉候选：用贴好的 key 向各家拉一次能用的模型名，出了新模型不用等我们改代码。
// 拉不到（没 key、网络慢、厂商不给列表）就只给 catalog 里的几个常用名。

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; ids: string[] }>();

/** 只留写字的对话模型，去掉向量、语音、出图之类 */
const SKIP = /(embed|tts|audio|realtime|transcribe|image|imagen|veo|whisper|dall-e|moderation|search|aqa|vision|computer|live)/i;

export function filterChatModels(provider: ProviderId, ids: string[]): string[] {
  const clean = ids.map((id) => id.replace(/^models\//, ""));
  const keep = clean.filter((id) => {
    if (SKIP.test(id)) return false;
    if (provider === "openai") return /^(gpt-|chatgpt-|o\d)/.test(id);
    if (provider === "gemini") return id.startsWith("gemini-");
    if (provider === "anthropic") return id.startsWith("claude-");
    if (provider === "xai") return id.startsWith("grok-");
    return true;
  });
  return [...new Set(keep)].sort((a, b) => b.localeCompare(a));
}

export async function listModels(
  provider: ProviderId,
  apiKey: string,
  doFetch: typeof fetch = fetch,
): Promise<string[]> {
  const cacheKey = `${provider}:${apiKey.slice(-6)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;

  const info = PROVIDERS[provider];
  let ids: string[] = [];
  try {
    if (info.api === "anthropic") {
      const client = new Anthropic({ apiKey, fetch: doFetch, timeout: 5_000, maxRetries: 0 });
      for await (const model of client.models.list({ limit: 100 })) ids.push(model.id);
    } else {
      const res = await doFetch(`${info.baseUrl}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { id: string }[] };
        ids = (body.data ?? []).map((m) => m.id);
      }
    }
  } catch {
    // 拉不到就用常用名
  }
  const result = filterChatModels(provider, ids);
  // OpenRouter 有几百个，页面上只给前 200 个
  const trimmed = provider === "openrouter" ? result.slice(0, 200) : result;
  if (trimmed.length) cache.set(cacheKey, { at: Date.now(), ids: trimmed });
  return trimmed.length ? trimmed : info.suggestions;
}
