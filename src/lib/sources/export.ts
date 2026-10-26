import type { Source } from "@/lib/db/types";
import { clock } from "./digest";

// 素材导出成 Markdown：整理结果在前，完整文字稿在后，可以直接放进 Obsidian。

type Exportable = Pick<Source, "url" | "title" | "author" | "duration_seconds" | "digest" | "transcript">;

export function sourceMarkdown(source: Exportable): string {
  const d = source.digest;
  const lines: string[] = [`# ${d?.title || source.title || source.url}`, ""];
  if (d?.title && source.title && d.title !== source.title) lines.push(`- 原标题：${source.title}`);
  if (source.author) lines.push(`- 作者：${source.author}`);
  lines.push(`- 链接：${source.url}`);
  if (source.duration_seconds) lines.push(`- 时长：${clock(source.duration_seconds)}`);

  if (d) {
    if (d.summary) lines.push("", "## 摘要", "", d.summary);
    if (d.key_points.length) lines.push("", "## 要点", "", ...d.key_points.map((p) => `- ${p}`));
    if (d.chapters.length) {
      lines.push("", "## 章节", "", ...d.chapters.map((c) => `- [${clock(c.start)}] ${c.title}${c.summary ? `：${c.summary}` : ""}`));
    }
    if (d.quotes.length) {
      lines.push("", "## 金句");
      for (const q of d.quotes) lines.push("", `> ${q.text}${q.zh ? `\n> ${q.zh}` : ""}`, "", `（${clock(q.start)}）`);
    }
    const b = d.breakdown;
    if (b.hook || b.structure.length || b.why_it_works || b.reuse) {
      lines.push("", "## 爆款拆解", "");
      if (b.hook) lines.push(`- 开头：${b.hook}`);
      if (b.structure.length) lines.push(`- 结构：${b.structure.map((s, i) => `${i + 1}. ${s}`).join(" ")}`);
      if (b.why_it_works) lines.push(`- 好在哪：${b.why_it_works}`);
      if (b.reuse) lines.push(`- 可以借鉴：${b.reuse}`);
    }
  }

  if (source.transcript?.length) {
    lines.push("", "## 文字稿", "", ...source.transcript.map((s) => `[${clock(s.start)}] ${s.text}\n`));
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
