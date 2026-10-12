// 一期的合规检查：只查账号档案和知识库里的禁用词。
// 二期再加品牌词规则和大模型复核。

export interface ComplianceResult {
  ok: boolean;
  hits: string[];
}

export function checkTabooWords(body: string, taboo: readonly string[]): ComplianceResult {
  const lower = body.toLowerCase();
  const hits = [...new Set(taboo.map((w) => w.trim()).filter(Boolean))].filter((word) =>
    lower.includes(word.toLowerCase()),
  );
  return { ok: hits.length === 0, hits };
}

// knowledge_items 里 taboo_words 一条可能是多行或逗号分隔的词表
export function parseTabooList(raw: string): string[] {
  return raw
    .split(/[\n,，、]/)
    .map((w) => w.trim())
    .filter(Boolean);
}
