import type { NewsItem } from "@/lib/db/types";
import { TAG_ALTRUISM, TAG_ANTI_HYPE } from "./filters";

// 每天的「今日 3 条」和日报，来自 kim 原来的 fetch_ai_radar.py：
// - 3 条按三个方向各挑一条：洞察（清醒剂 / HN / 周刊）、实用（开源模型 / GitHub / 利他）、产品（PH / SideProject）
// - 日报：热度前 5 + 按信源分组 + 利他专版 + 今日 3 条
// 原脚本按 Mac 本地时间切日；工作台统一按北京时间。

export const DIGEST_TZ_OFFSET = "+08:00";

/** 北京时间的日期 YYYY-MM-DD */
export function digestDay(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 某个北京时间日期的起止（UTC ISO） */
export function dayRange(day: string): [string, string] {
  const start = new Date(`${day}T00:00:00${DIGEST_TZ_OFFSET}`);
  return [start.toISOString(), new Date(start.getTime() + 86400_000).toISOString()];
}

type Pickable = Pick<NewsItem, "id" | "source" | "title" | "summary" | "url" | "tags" | "heat">;

const LANES: { name: string; match: (n: Pickable) => boolean }[] = [
  {
    name: "洞察",
    match: (n) => n.tags.includes(TAG_ANTI_HYPE) || ["Hacker News", "阮一峰周刊"].includes(n.source),
  },
  {
    name: "实用",
    match: (n) =>
      n.tags.includes(TAG_ALTRUISM) || ["r/LocalLLaMA", "GitHub Trending", "NodeSeek"].includes(n.source),
  },
  { name: "产品", match: (n) => ["Product Hunt", "r/SideProject"].includes(n.source) },
];

/** 三个方向各挑热度最高的一条，挑不满就按热度补齐 */
export function pickDaily<T extends Pickable>(news: T[], count = 3): T[] {
  const byHeat = [...news].sort((a, b) => b.heat - a.heat);
  const picked: T[] = [];
  for (const lane of LANES) {
    const hit = byHeat.find((n) => lane.match(n) && !picked.includes(n));
    if (hit) picked.push(hit);
  }
  for (const n of byHeat) {
    if (picked.length >= count) break;
    if (!picked.includes(n)) picked.push(n);
  }
  return picked.slice(0, count);
}

export function materialOf(n: Pickable): string {
  return [`标题：${n.title}`, n.summary ? `摘要：${n.summary}` : "", `来源：${n.source}`, `链接：${n.url}`]
    .filter(Boolean)
    .join("\n");
}

export interface DigestPost {
  handle: string;
  body: string;
  news: Pickable;
}

export interface Digest {
  day: string;
  top: Pickable[];
  radar: string;
  posts: string;
  altruism: string;
}

const sourceLabel = (s: string) => (s === "x" ? "X（Grok 搜索）" : s);

function itemLines(n: Pickable, i: number): string[] {
  return [
    `### ${i}. ${n.title}`,
    `- **来源**：\`${sourceLabel(n.source)}\`${n.heat ? ` ｜ **热度**：${n.heat}` : ""}`,
    `- **直达链接**：${n.url}`,
    ...(n.summary ? [`- **内容概要**：${n.summary}`] : []),
    "",
  ];
}

/** 生成和原脚本同样分三份的 Markdown：AI 每日素材、今日 X 推文、利他素材 */
export function buildDigest(day: string, news: Pickable[], posts: DigestPost[]): Digest {
  const top = [...news].sort((a, b) => b.heat - a.heat).slice(0, 5);

  const radar = [`# 每日 AI 素材雷达（${day}）`, "", `> 共 ${news.length} 条，来自工作台资讯雷达。`, ""];
  radar.push("## 今日热度 TOP 5", "");
  top.forEach((n, i) => radar.push(...itemLines(n, i + 1)));

  const groups = new Map<string, Pickable[]>();
  for (const n of news) groups.set(n.source, [...(groups.get(n.source) ?? []), n]);
  for (const [source, items] of groups) {
    radar.push("---", "", `## ${sourceLabel(source)}`, "");
    items.forEach((n, i) => radar.push(...itemLines(n, i + 1)));
  }

  const postLines = [`# 今日发 X 精选推文（${day}）`, "", "> 草稿已在工作台「内容」里，审核后可直接排期发布。", ""];
  if (posts.length === 0) postLines.push("*今天没有生成推文*");
  posts.forEach((p, i) =>
    postLines.push(
      `## 选题 ${i + 1}：${p.news.title}`,
      `- **账号**：@${p.handle}`,
      `- **来源**：\`${sourceLabel(p.news.source)}\` ｜ **直达链接**：${p.news.url}`,
      "",
      "```text",
      p.body,
      "```",
      "",
    ),
  );

  const perks = news.filter((n) => n.tags.includes(TAG_ALTRUISM));
  const altruism = [`# 利他素材：羊毛 / 平替 / 活动（${day}）`, ""];
  if (perks.length === 0) altruism.push("*今天没有新的利他线索*");
  perks.forEach((n, i) => altruism.push(...itemLines(n, i + 1)));

  return { day, top, radar: radar.join("\n"), posts: postLines.join("\n"), altruism: altruism.join("\n") };
}
