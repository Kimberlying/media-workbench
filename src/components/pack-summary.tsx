import { X_POST_MAX } from "@/lib/content/formats";
import { countChars, MODE_LABELS } from "@/lib/content/x-post";
import type { ContentPack } from "@/lib/xhs/schema";
import { THEMES } from "@/lib/xhs/schema";
import { ghostButtonClass } from "./ui";

const LAYOUT_LABELS: Record<string, string> = {
  cover: "封面",
  list: "要点",
  steps: "步骤",
  compare: "对比",
  quote: "引用",
  prompt: "模板",
};

// 内容包的结构化部分：卡片预览、标题备选、自动检查，以及下载发布包（含出好的图片）
export function PackSummary({ contentId, pack, body }: { contentId: string; pack: ContentPack; body: string }) {
  if (pack.kind === "post") {
    return (
      <div className="mt-2 text-xs text-muted">
        {countChars(body)}/{X_POST_MAX} 字符 · {pack.mode === "topic" ? "按选题生成" : MODE_LABELS[pack.mode]} · 模型 {pack.model}
        {pack.checks.length > 0 ? (
          <span className="text-warn"> · 留意：{pack.checks.join("；")}</span>
        ) : null}
      </div>
    );
  }
  const cards = pack.kind === "xhs" ? pack.cards : pack.graphics;
  return (
    <div className="mt-3 grid gap-2 rounded-2xl bg-soft p-4 text-sm">
      {pack.kind === "xhs" ? (
        <div>
          <div className="text-muted">标题备选</div>
          <ol className="list-decimal pl-5">
            {pack.titles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {cards && cards.cards.length > 0 ? (
        <div>
          <div className="text-muted">
            {pack.kind === "xhs" ? "小红书卡片" : "公众号贴图"} {cards.cards.length} 张 ·{" "}
            {THEMES[cards.meta.theme]?.split("：")[0] ?? cards.meta.theme} · {cards.meta.width}×{cards.meta.height}
          </div>
          <ol className="mt-1 flex gap-2 overflow-x-auto pb-1">
            {cards.cards.map((card, i) => (
              <li key={card.file} className="w-28 shrink-0 text-xs">
                <a href={`/api/contents/${contentId}/cards/${i + 1}`} target="_blank" rel="noreferrer">
                  {/* 卡片图是接口当场出的 PNG，不走 next/image 的优化 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/contents/${contentId}/cards/${i + 1}`}
                    alt={card.title || card.quote || card.prompt || card.file}
                    loading="lazy"
                    className="w-full rounded border border-line"
                    style={{ aspectRatio: `${cards.meta.width} / ${cards.meta.height}` }}
                  />
                </a>
                <div className="mt-1 truncate text-muted">
                  {i + 1}. [{LAYOUT_LABELS[card.layout] ?? card.layout}] {card.title || card.quote || card.prompt}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {pack.checks.length > 0 ? (
        <div>
          <div className="text-warn">发布前留意</div>
          <ul className="list-disc pl-5">
            {pack.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <a href={`/api/contents/${contentId}/pack`} className={ghostButtonClass}>
          下载发布包
        </a>
      </div>
    </div>
  );
}
