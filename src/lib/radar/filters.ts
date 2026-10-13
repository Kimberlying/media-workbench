// 分类和去重规则，来自 kim 原来的 fetch_ai_radar.py：
// - 利他（羊毛 / 平替 / 活动）：先过黑名单，再要求命中强特征词
// - 清醒剂：踩坑、骗局、泡沫一类
// - 去重：14 天内同一链接不再收；3 天内标题互相包含、或核心词重合 3 个以上不再收

import type { FeedItem } from "./feeds";

const ALTRUISM_BLACKLIST = [
  "大脑活动", "脑活动", "生理活动", "心脏活动", "神经活动",
  "欺骗活动", "犯罪活动", "非法活动", "间谍活动", "军事活动",
  "越狱活动", "抗议活动", "选举活动", "罢工活动", "欺诈活动",
  "宣传活动", "政治活动", "游说活动", "恶意活动", "公关活动",
  "黑产活动", "气候欺骗", "收一张", "收码", "求购", "出出出",
  "收小鸡", "明盘出", "带价私", "借一部", "新陈代谢",
];

const ALTRUISM_KEYWORDS = [
  "免费额度", "免费算力", "免费api", "免费接口", "免绑卡",
  "赠送额度", "送算力", "送会员", "白嫖", "羊毛", "开源平替",
  "开源替代", "平替", "黑客松", "开发者大赛", "创新大赛",
  "黑客马拉松", "免费领", "限时免费", "优惠码", "免费商用",
  "免费试用", "云额度", "算力补贴", "创业扶持", "免单",
  "free tier", "free credits", "free credit", "free api",
  "free token", "open source alternative", "free alternative",
  "ai活动", "开发者活动", "社区活动", "线上活动", "福利活动",
  "优惠活动", "hackathon",
];

const TOOLISH = ["tool", "model", "api", "app", "service", "开源", "工具", "模型", "代码"];

const ANTI_HYPE_KEYWORDS = [
  "scam", "theft", "fail", "hype", "loss", "pain", "bubble", "sued", "doom", "burn",
  "割韭菜", "踩坑", "骗局", "泡沫", "避坑", "痛苦", "起诉", "盗用", "耗资", "亏损", "失联", "盗窃",
];

export const TAG_ALTRUISM = "利他";
export const TAG_ANTI_HYPE = "清醒";

function text(item: Pick<FeedItem, "title" | "summary">) {
  return `${item.title} ${item.summary}`.toLowerCase();
}

export function isAltruism(item: Pick<FeedItem, "title" | "summary">): boolean {
  const full = text(item);
  if (ALTRUISM_BLACKLIST.some((b) => full.includes(b))) return false;
  if (ALTRUISM_KEYWORDS.some((k) => full.includes(k))) return true;
  const title = item.title.toLowerCase();
  return (title.includes("免费") || /\bfree\b/.test(title)) && TOOLISH.some((w) => full.includes(w));
}

export function isAntiHype(item: Pick<FeedItem, "title" | "summary">): boolean {
  const full = text(item);
  return ANTI_HYPE_KEYWORDS.some((k) => (/^[a-z]+$/.test(k) ? new RegExp(`\\b${k}`).test(full) : full.includes(k)));
}

/** 利他优先，其次清醒剂；都不是就不打分类标签 */
export function classify(item: Pick<FeedItem, "title" | "summary">): string[] {
  if (isAltruism(item)) return [TAG_ALTRUISM];
  if (isAntiHype(item)) return [TAG_ANTI_HYPE];
  return [];
}

/** 去掉协议、查询参数和结尾斜杠，只用于比较 */
export function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "your", "can", "built", "made", "today",
  "using", "free", "project", "open", "source", "comments", "reddit", "producthunt", "github",
  "https", "http", "com", "app",
]);

/** 英文/数字专有词（3 个字符以上），用来判断两条是不是在说同一件事 */
export function coreKeywords(s: string): Set<string> {
  const out = new Set<string>();
  for (const [w] of s.toLowerCase().matchAll(/[a-z0-9_\-.]{3,}/g)) {
    if (!STOP_WORDS.has(w) && !/^\d+$/.test(w)) out.add(w);
  }
  return out;
}

function compactTitle(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export interface SeenItem {
  title: string;
  url: string;
  summary?: string;
  fetched_at: string;
}

export const URL_WINDOW_DAYS = 14;
export const TITLE_WINDOW_DAYS = 3;

export function duplicateReason(item: FeedItem, seen: SeenItem[], now = new Date()): string | null {
  const url = normalizeUrl(item.url);
  const title = compactTitle(item.title);
  const kws = coreKeywords(`${item.title} ${item.summary}`);
  const titleCutoff = now.getTime() - TITLE_WINDOW_DAYS * 86400_000;

  for (const s of seen) {
    if (url && normalizeUrl(s.url) === url) return "14 天内链接相同";
    if (new Date(s.fetched_at).getTime() < titleCutoff) continue;

    const other = compactTitle(s.title);
    if (title && other && (title.includes(other) || other.includes(title))) return "3 天内标题重合";
    const otherKws = coreKeywords(`${s.title} ${s.summary ?? ""}`);
    let overlap = 0;
    for (const k of kws) if (otherKws.has(k)) overlap++;
    if (overlap >= 3) return "3 天内核心词重合";
  }
  return null;
}

/** 按热度从高到低，去掉与历史或本批前面条目重复的 */
export function dedupe(items: FeedItem[], seen: SeenItem[], now = new Date()): FeedItem[] {
  const kept: FeedItem[] = [];
  const pool = [...seen];
  for (const item of [...items].sort((a, b) => b.heat - a.heat)) {
    if (duplicateReason(item, pool, now)) continue;
    kept.push(item);
    pool.push({ title: item.title, url: item.url, summary: item.summary, fetched_at: now.toISOString() });
  }
  return kept;
}
