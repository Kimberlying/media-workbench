import type { MetricSnapshot } from "@/lib/db/types";
import { PublishRejected, splitThread, type PlatformConnector } from "./types";

// X API v2。需要用户上下文的 OAuth 2.0 访问令牌（tweet.write、tweet.read、users.read）。
// 一期只发文字和推文串；媒体上传二期再接。
const API = "https://api.x.com/2";

interface CreateTweetResponse {
  data?: { id: string };
  errors?: { message: string }[];
}

interface TweetLookupResponse {
  data?: {
    id: string;
    public_metrics?: {
      impression_count?: number;
      like_count?: number;
      reply_count?: number;
      retweet_count?: number;
      quote_count?: number;
    };
  }[];
}

export const xConnector: PlatformConnector = {
  platform: "x",
  supportsApiPublish: true,

  async publish(input, ctx) {
    if (!ctx.accessToken) throw new Error("X 账号还没授权");
    const doFetch = ctx.fetch ?? fetch;
    const parts = splitThread(input.body);
    if (parts.length === 0) throw new Error("正文为空");

    let firstId: string | undefined;
    let replyTo: string | undefined;
    for (const text of parts) {
      const res = await doFetch(`${API}/tweets`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ctx.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text,
          ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as CreateTweetResponse;
      if (!res.ok || !json.data) {
        const message = `X 发布失败（${res.status}）：${json.errors?.[0]?.message ?? "未知错误"}`;
        // 第一条就被拒：什么都没发出去，可以放心重试；推文串发到一半则不确定
        throw firstId ? new Error(`${message}；推文串已发出前 ${parts.indexOf(text)} 条`) : new PublishRejected(message);
      }
      firstId ??= json.data.id;
      replyTo = json.data.id;
    }

    return { method: "api", platformPostId: firstId! };
  },

  async fetchMetrics(postIds, ctx) {
    const result = new Map<string, MetricSnapshot>();
    if (!ctx.accessToken || postIds.length === 0) return result;
    const doFetch = ctx.fetch ?? fetch;

    // 每次最多查 100 条
    for (let i = 0; i < postIds.length; i += 100) {
      const ids = postIds.slice(i, i + 100).join(",");
      const res = await doFetch(`${API}/tweets?ids=${ids}&tweet.fields=public_metrics`, {
        headers: { authorization: `Bearer ${ctx.accessToken}` },
      });
      if (!res.ok) throw new Error(`X 取数失败（${res.status}）`);
      const json = (await res.json()) as TweetLookupResponse;
      for (const tweet of json.data ?? []) {
        const m = tweet.public_metrics ?? {};
        result.set(tweet.id, {
          views: m.impression_count ?? 0,
          likes: m.like_count ?? 0,
          comments: m.reply_count ?? 0,
          shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
          // X 不按帖子给涨粉数
          follows: 0,
        });
      }
    }
    return result;
  },
};
