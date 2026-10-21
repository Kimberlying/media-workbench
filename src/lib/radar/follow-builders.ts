// follow-builders 的三个公开 feed：X 上的 AI builder 推文、播客文字稿、官方工程博客。
// 上游 zarazhangrui/follow-builders（MIT）每天用 GitHub Actions 生成；接入方式参考 Kimberlying/signal-desk。
// 抓取不经过模型，链接都是原始链接。

import { cleanHtml, type FeedItem } from "@/lib/radar/feeds";

const BASE = "https://raw.githubusercontent.com/zarazhangrui/follow-builders/main";
export const FOLLOW_BUILDERS_URLS = {
  x: `${BASE}/feed-x.json`,
  podcasts: `${BASE}/feed-podcasts.json`,
  blogs: `${BASE}/feed-blogs.json`,
};

interface Tweet {
  text?: string;
  url?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
}

/** 去掉推文里的 t.co 短链和多余空白 */
function cleanTweet(text: string): string {
  return text.replace(/https?:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** X builder 推文：每人只取最热的一条，热度 = 点赞 + 转发×3 + 回复×2（和 signal-desk 一致） */
export function parseBuilderTweets(json: string, limit: number): FeedItem[] {
  const data = JSON.parse(json) as { x?: { name?: string; handle?: string; tweets?: Tweet[] }[] };
  const items: FeedItem[] = [];
  for (const builder of data.x ?? []) {
    const name = builder.name || builder.handle || "";
    let best: FeedItem | null = null;
    for (const t of builder.tweets ?? []) {
      const text = cleanTweet(t.text ?? "");
      // 太短的一般是回复或纯链接，没有信息量
      if (!t.url || text.length < 20) continue;
      const heat = Number(t.likes ?? 0) + Number(t.retweets ?? 0) * 3 + Number(t.replies ?? 0) * 2;
      if (!best || heat > best.heat) {
        best = { source: "X Builders", title: clip(`${name}：${text}`, 80), summary: clip(text, 160), url: t.url, heat };
      }
    }
    if (best) items.push(best);
  }
  return items.sort((a, b) => b.heat - a.heat).slice(0, limit);
}

/** 播客：上游每期附完整文字稿，摘要取开头 */
export function parseBuilderPodcasts(json: string, limit: number, heat: number): FeedItem[] {
  const data = JSON.parse(json) as {
    podcasts?: { name?: string; title?: string; url?: string; transcript?: string }[];
  };
  const items: FeedItem[] = [];
  for (const p of data.podcasts ?? []) {
    if (!p.url || !p.title) continue;
    const summary = clip(cleanHtml(p.transcript), 160);
    items.push({ source: "Builder 播客", title: p.name ? `${p.name}：${p.title}` : p.title, summary, url: p.url, heat });
    if (items.length >= limit) break;
  }
  return items;
}

/** 官方博客（Anthropic Engineering、Claude Blog 等） */
export function parseBuilderBlogs(json: string, limit: number, heat: number): FeedItem[] {
  const data = JSON.parse(json) as {
    blogs?: { name?: string; title?: string; url?: string; description?: string; content?: string }[];
  };
  const items: FeedItem[] = [];
  for (const b of data.blogs ?? []) {
    if (!b.url || !b.title) continue;
    const summary = clip(cleanHtml(b.description || b.content), 160);
    items.push({ source: b.name || "官方博客", title: b.title, summary, url: b.url, heat });
    if (items.length >= limit) break;
  }
  return items;
}
