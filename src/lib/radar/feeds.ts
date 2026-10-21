// 固定信源：从 kim 原来的 fetch_ai_radar.py 搬过来，抓取不经过模型，链接都是原始链接。
// Product Hunt / r/SideProject / Hacker News 用 Buzzing 的中文版 JSON Feed。
// 另加 follow-builders 的三个 feed（X builder 推文、播客、官方博客），见 follow-builders.ts。

import {
  FOLLOW_BUILDERS_URLS,
  parseBuilderBlogs,
  parseBuilderPodcasts,
  parseBuilderTweets,
} from "@/lib/radar/follow-builders";

export interface FeedItem {
  source: string;
  title: string;
  summary: string;
  url: string;
  /** 热度分：点赞、星数等；信源没有给的用固定基础分 */
  heat: number;
}

export type FetchText = (url: string) => Promise<string | null>;

const AI_KEYWORDS = [
  "ai", "gpt", "model", "llm", "bot", "agent", "prompt", "code", "app", "saas", "chrome",
  "智能", "模型", "生成", "工具",
];

const NODESEEK_KEYWORDS = [
  "vps", "cloudflare", "cf", "api", "docker", "出海", "域名", "开源", "节点", "卡", "网络", "探针", "教程",
];

/** 英文词按整词匹配（避免 "ai" 命中 "said"），中文按子串匹配 */
export function matchesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) =>
    /^[a-z0-9 ]+$/.test(kw) ? new RegExp(`\\b${kw}\\b`).test(lower) : lower.includes(kw),
  );
}

export function cleanHtml(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // 订阅源里的正文常是转义过的 HTML，先还原尖括号再去标签
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&[a-zA-Z]+;|&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 解析（纯函数，便于测试）

export function parseBuzzing(json: string, source: string, limit: number, aiOnly = true): FeedItem[] {
  const data = JSON.parse(json) as {
    items?: { title?: string; summary?: string; content_text?: string; url?: string; _score?: number }[];
  };
  const items: FeedItem[] = [];
  for (const it of data.items ?? []) {
    const title = it.title ?? "";
    const rawSummary = it.summary || it.content_text || "";
    if (!it.url || (aiOnly && !matchesAny(`${title} ${rawSummary}`, AI_KEYWORDS))) continue;

    let score = it._score ?? 0;
    const points = rawSummary.match(/↑\s*([\d,]+)\s*(?:HN Points|Points)/);
    if (points) score = Math.max(score, Number(points[1].replace(/,/g, "")));
    const upvotes = rawSummary.match(/([\d.]+)K\s*Reddit Upvotes/);
    if (upvotes) score = Math.max(score, Math.round(Number(upvotes[1]) * 1000));

    items.push({ source, title, summary: cleanHtml(rawSummary).slice(0, 160), url: it.url, heat: score || 150 });
    if (items.length >= limit) break;
  }
  return items;
}

function tag(block: string, name: string): string {
  return block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
}

/** Atom（Reddit、阮一峰） */
export function parseAtom(xml: string, source: string, limit: number, heat: number): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = cleanHtml(tag(entry, "title"));
    const url = entry.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? "";
    if (!title || !url || title.toLowerCase().startsWith("daily discussion")) continue;
    const summary = cleanHtml(tag(entry, "content") || tag(entry, "summary")).slice(0, 160);
    items.push({ source, title, summary, url, heat });
    if (items.length >= limit) break;
  }
  return items;
}

/** RSS 2.0（NodeSeek、Godly） */
export function parseRss(
  xml: string,
  source: string,
  limit: number,
  heat: number,
  keywords?: string[],
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = cleanHtml(tag(item, "title"));
    const url = cleanHtml(tag(item, "link"));
    const summary = cleanHtml(tag(item, "description")).slice(0, 160);
    if (!title || !url) continue;
    if (keywords && !matchesAny(`${title} ${summary}`, keywords)) continue;
    items.push({ source, title, summary, url, heat });
    if (items.length >= limit) break;
  }
  return items;
}

export function parseGithubTrending(html: string, limit: number): FeedItem[] {
  const items: FeedItem[] = [];
  for (const [, article] of html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)) {
    const repo = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([\w.-]+\/[\w.-]+)"/)?.[1];
    if (!repo) continue;
    const desc = cleanHtml(article.match(/<p[^>]*class="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]);
    const stars = article.match(/([\d,]+)\s+stars today/)?.[1];
    const starsNum = stars ? Number(stars.replace(/,/g, "")) : 100;
    items.push({
      source: "GitHub Trending",
      title: stars ? `${repo}（今日 +${stars}★）` : repo,
      summary: desc.slice(0, 160),
      url: `https://github.com/${repo}`,
      heat: Math.round(starsNum * 1.5),
    });
    if (items.length >= limit) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// 信源表

export interface FeedSource {
  id: string;
  label: string;
  fetch(fetchText: FetchText): Promise<FeedItem[]>;
}

async function buzzing(fetchText: FetchText, url: string, label: string, limit: number) {
  const text = await fetchText(url);
  return text ? parseBuzzing(text, label, limit) : [];
}

export const FEEDS: FeedSource[] = [
  {
    id: "producthunt",
    label: "Product Hunt",
    fetch: (f) => buzzing(f, "https://ph.buzzing.cc/feed.json", "Product Hunt", 5),
  },
  {
    id: "sideproject",
    label: "r/SideProject",
    fetch: (f) => buzzing(f, "https://sideproject.buzzing.cc/feed.json", "r/SideProject", 5),
  },
  {
    id: "hn",
    label: "Hacker News",
    fetch: (f) => buzzing(f, "https://hn.buzzing.cc/feed.json", "Hacker News", 6),
  },
  {
    id: "localllama",
    label: "r/LocalLLaMA",
    async fetch(f) {
      const xml = await f("https://www.reddit.com/r/LocalLLaMA/hot/.rss");
      const items = xml?.includes("<feed") ? parseAtom(xml, "r/LocalLLaMA", 5, 150) : [];
      // Reddit 经常限流，退回 Buzzing 科技频道里的开源模型讨论
      return items.length > 0 ? items : buzzing(f, "https://tech.buzzing.cc/feed.json", "r/LocalLLaMA", 5);
    },
  },
  {
    id: "github",
    label: "GitHub Trending",
    async fetch(f) {
      const html = await f("https://github.com/trending");
      return html ? parseGithubTrending(html, 6) : [];
    },
  },
  {
    id: "nodeseek",
    label: "NodeSeek",
    async fetch(f) {
      const xml = await f("https://rss.nodeseek.com");
      return xml ? parseRss(xml, "NodeSeek", 3, 350, NODESEEK_KEYWORDS) : [];
    },
  },
  {
    id: "ruanyifeng",
    label: "阮一峰周刊",
    async fetch(f) {
      const xml = await f("https://www.ruanyifeng.com/blog/atom.xml");
      return xml ? parseAtom(xml, "阮一峰周刊", 2, 500) : [];
    },
  },
  {
    id: "godly",
    label: "Godly",
    async fetch(f) {
      const xml = await f("https://godly.website/feed.xml");
      return xml ? parseRss(xml, "Godly", 2, 200) : [];
    },
  },
  {
    id: "builders-x",
    label: "X Builders",
    async fetch(f) {
      const json = await f(FOLLOW_BUILDERS_URLS.x);
      return json ? parseBuilderTweets(json, 6) : [];
    },
  },
  {
    id: "builders-podcasts",
    label: "Builder 播客",
    async fetch(f) {
      const json = await f(FOLLOW_BUILDERS_URLS.podcasts);
      return json ? parseBuilderPodcasts(json, 2, 300) : [];
    },
  },
  {
    id: "builders-blogs",
    label: "官方博客",
    async fetch(f) {
      const json = await f(FOLLOW_BUILDERS_URLS.blogs);
      return json ? parseBuilderBlogs(json, 3, 400) : [];
    },
  },
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export const httpFetchText: FetchText = async (url) => {
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
};
