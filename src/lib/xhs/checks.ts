import type { Card, CardsFile } from "./schema";

// 发布前检查里能自动判断的部分，规则来自 build-xhs-content-pack 的
// references/quality_checks.md 和 card_structures.md 的文案长度建议。
// 返回的是提醒，不拦截：这些都是模板默认值，不是平台硬规定。

// 字数按字符算，中英文混排时只是近似
const len = (s: string | undefined) => [...(s ?? "")].length;

// 不能出现的承诺类说法（content_safety.md）
export const RISKY_CLAIMS = ["保证有效", "必然赚钱", "稳赚", "100%", "绝对有效", "包过", "零风险", "躺赚"];

export function checkCards(file: CardsFile, opts: { minCards?: number; maxCards?: number; landscape?: boolean } = {}) {
  const issues: string[] = [];
  const { cards } = file;
  const minCards = opts.minCards ?? 8;
  const maxCards = opts.maxCards ?? 12;
  const bulletMax = opts.landscape ? 18 : 24;
  const promptMax = opts.landscape ? 120 : 220;

  if (!opts.landscape && (cards.length < minCards || cards.length > maxCards)) {
    issues.push(`卡片 ${cards.length} 张，默认建议 ${minCards}–${maxCards} 张`);
  }
  if (!opts.landscape && cards[0]?.layout !== "cover") {
    issues.push("第一张不是封面");
  }

  const seen = new Set<string>();
  cards.forEach((card, i) => {
    const n = i + 1;
    if (!/^\d{2}_[\w-]+\.png$/.test(card.file)) issues.push(`第 ${n} 张文件名 ${card.file} 不是「两位序号_名称.png」`);
    if (seen.has(card.file)) issues.push(`文件名 ${card.file} 重复`);
    seen.add(card.file);
    if (!card.file.startsWith(String(n).padStart(2, "0"))) issues.push(`第 ${n} 张的序号和顺序不一致`);
    issues.push(...checkCard(card, n, { bulletMax, promptMax, cover: i === 0 }));
  });
  return issues;
}

function checkCard(card: Card, n: number, limits: { bulletMax: number; promptMax: number; cover: boolean }) {
  const issues: string[] = [];
  const titleMax = limits.cover ? 20 : 18;
  if (card.layout !== "quote" && card.layout !== "prompt" && !card.title.trim()) {
    issues.push(`第 ${n} 张没有标题`);
  }
  if (len(card.title) > titleMax) issues.push(`第 ${n} 张标题 ${len(card.title)} 字，建议不超过 ${titleMax}`);

  if (card.layout === "list" || card.layout === "steps") {
    const bullets = card.bullets ?? [];
    if (bullets.length < 3 || bullets.length > 6) issues.push(`第 ${n} 张要点 ${bullets.length} 条，建议 3–6 条`);
    bullets.forEach((b) => {
      if (len(b) > limits.bulletMax) issues.push(`第 ${n} 张要点「${b.slice(0, 10)}…」超过 ${limits.bulletMax} 字`);
    });
  }
  if (card.layout === "compare" && (!card.left?.items.length || !card.right?.items.length)) {
    issues.push(`第 ${n} 张对比卡缺少左栏或右栏`);
  }
  if (card.layout === "quote" && !card.quote?.trim()) issues.push(`第 ${n} 张引用卡没有 quote`);
  if (card.layout === "prompt") {
    if (!card.prompt?.trim()) issues.push(`第 ${n} 张模板卡没有 prompt`);
    else if (len(card.prompt) > limits.promptMax) issues.push(`第 ${n} 张 prompt 超过 ${limits.promptMax} 字`);
  }
  return issues;
}

export function checkRiskyClaims(texts: string[]): string[] {
  const all = texts.join("\n");
  return RISKY_CLAIMS.filter((w) => all.includes(w)).map((w) => `出现承诺类说法「${w}」`);
}

/** 正文不该逐张复述卡片：卡片标题有一半以上原样出现在正文里就提醒 */
export function checkBodyRepeatsCards(body: string, cards: Card[]): string[] {
  const titles = cards.slice(1).map((c) => c.title.trim()).filter((t) => len(t) >= 4);
  if (titles.length === 0) return [];
  const repeated = titles.filter((t) => body.includes(t)).length;
  return repeated / titles.length > 0.5 ? ["发布正文在逐张复述卡片，建议改成补充判断和背景"] : [];
}
