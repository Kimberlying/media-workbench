import type { CSSProperties, ReactNode } from "react";
import type { Card, CardsFile } from "@/lib/xhs/schema";
import { CARD_THEMES, type CardTheme } from "./themes";

// 一张卡片的画面，按 build-xhs-content-pack 的 render_cards.py 逐项移植：同样的尺寸、留白、字号和版式，
// 交给 next/og（Satori）出 PNG。Pillow 是逐行画字，这里先按字宽估算行数来选字号，再让 Satori 换行。

export const FONT_FAMILY = "Noto Sans SC";

/** 估算一段文字的宽度：中文和全角符号按 1 个字号宽，其余按 0.55 */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) units += /[\u0000-ÿ]/.test(ch) ? 0.55 : 1;
  return units * size;
}

export function countLines(text: string, size: number, maxWidth: number): number {
  return text
    .split("\n")
    .reduce((n, para) => n + Math.max(1, Math.ceil(textWidth(para, size) / maxWidth)), 0);
}

/** 从 start 往下每次减 2，找到能在 maxLines 行内放下的字号 */
export function fitSize(text: string, maxWidth: number, maxLines: number, start: number, min: number) {
  for (let size = start; size >= min; size -= 2) {
    const lines = countLines(text, size, maxWidth);
    if (lines <= maxLines) return { size, lines };
  }
  return { size: min, lines: countLines(text, min, maxWidth) };
}

interface Ctx {
  theme: CardTheme;
  width: number;
  height: number;
  portrait: boolean;
  accent: string;
}

// Satori 不接受值为 undefined 的样式，先去掉
const abs = (style: CSSProperties): CSSProperties =>
  Object.fromEntries(
    Object.entries({ position: "absolute", display: "flex", ...style }).filter(([, v]) => v !== undefined),
  );

function Text(props: {
  x: number;
  y: number;
  width?: number;
  size: number;
  gap: number;
  color: string;
  bold?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={abs({
        left: props.x,
        top: props.y,
        width: props.width,
        fontSize: props.size,
        lineHeight: `${props.size + props.gap}px`,
        fontWeight: props.bold ? 700 : 400,
        color: props.color,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      })}
    >
      {props.children}
    </div>
  );
}

function Panel({ ctx, x, y, w, h, outline }: { ctx: Ctx; x: number; y: number; w: number; h: number; outline?: number }) {
  const { theme } = ctx;
  return (
    <div
      style={abs({
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: theme.visual.radius,
        background: theme.surface,
        border: `${outline ?? theme.visual.outline_width}px solid ${theme.line}`,
      })}
    />
  );
}

function luminanceText(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 155 ? "#141615" : "#FFFFFF";
}

/** 画项目符号，返回文字起点的 x */
function Marker({ ctx, x, y, size, label, color }: { ctx: Ctx; x: number; y: number; size: number; label: string; color: string }) {
  const marker = ctx.theme.visual.marker;
  const fontSize = Math.max(16, Math.floor(size * 0.56));
  if (marker === "index") {
    return (
      <Text x={x} y={y + Math.max(0, Math.floor((size - fontSize) / 2) - 2)} size={fontSize} gap={0} color={color} bold>
        {label}
      </Text>
    );
  }
  if (marker === "dash") {
    const w = Math.max(size, Math.floor(size * 1.2));
    const t = Math.max(4, Math.floor(size / 7));
    return <div style={abs({ left: x, top: y + size / 2 - t / 2, width: w, height: t, background: color })} />;
  }
  return (
    <div
      style={abs({
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        background: color,
        alignItems: "center",
        justifyContent: "center",
        fontSize,
        fontWeight: 700,
        color: luminanceText(color),
      })}
    >
      {label}
    </div>
  );
}

function markerAdvance(ctx: Ctx, size: number, label: string): number {
  const marker = ctx.theme.visual.marker;
  if (marker === "index") return Math.max(size, textWidth(label, Math.max(16, Math.floor(size * 0.56)))) + 18;
  if (marker === "dash") return Math.max(size, Math.floor(size * 1.2)) + 22;
  return size + 24;
}

function Chrome({ ctx }: { ctx: Ctx }) {
  const { theme, width, height, accent } = ctx;
  const chrome = theme.visual.chrome;
  if (chrome === "product") {
    const navY = Math.max(30, Math.floor(height * 0.032));
    const indicator = Math.max(54, Math.floor(width * 0.085));
    const right = Math.max(22, Math.floor(width * 0.035));
    const ring = Math.max(2, Math.floor(width * 0.003));
    return (
      <>
        <div style={abs({ left: 0, top: navY, width, height: 1, background: theme.line })} />
        <div
          style={abs({
            left: width - indicator - right,
            top: Math.max(8, Math.floor(navY / 4)),
            width: indicator,
            height: Math.max(6, Math.floor(navY / 5)),
            borderRadius: 8,
            background: theme.accents.blue,
          })}
        />
        <div
          style={abs({
            left: width * 0.18,
            top: height * 0.78,
            width: width * 0.64,
            height: height * 0.34,
            borderRadius: "50%",
            border: `${ring}px solid ${theme.line}`,
          })}
        />
      </>
    );
  }
  if (chrome === "data") {
    const header = Math.max(20, Math.floor(height * 0.024));
    const tab = Math.max(90, Math.floor(width * 0.16));
    const tabH = Math.max(12, Math.floor(header / 2));
    return (
      <>
        <div style={abs({ left: 0, top: 0, width, height: header, background: theme.ink })} />
        <div style={abs({ left: 0, top: header, width, height: Math.max(5, Math.floor(header / 4)), background: theme.accents.coral })} />
        <div style={abs({ left: 0, top: height - tabH, width: tab, height: tabH, background: theme.accents.coral })} />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={abs({ left: tab + Math.floor((i * (width - tab)) / 5), top: height - tabH, width: 1, height: tabH, background: theme.line })}
          />
        ))}
      </>
    );
  }
  return <div style={abs({ left: 0, top: 0, width, height: Math.max(14, Math.floor(height * 0.018)), background: accent })} />;
}

function GridPattern({ ctx }: { ctx: Ctx }) {
  if (ctx.theme.visual.pattern !== "grid") return null;
  const step = ctx.portrait ? 82 : 64;
  const lines: ReactNode[] = [];
  for (let x = 0; x <= ctx.width; x += step) {
    lines.push(<div key={`x${x}`} style={abs({ left: x, top: 0, width: 1, height: ctx.height, background: ctx.theme.soft })} />);
  }
  for (let y = 0; y <= ctx.height; y += step) {
    lines.push(<div key={`y${y}`} style={abs({ left: 0, top: y, width: ctx.width, height: 1, background: ctx.theme.soft })} />);
  }
  return <>{lines}</>;
}

function Bullets({ ctx, items, y, margin, footerTop, numbered, compact }: {
  ctx: Ctx;
  items: string[];
  y: number;
  margin: number;
  footerTop: number;
  numbered: boolean;
  compact: boolean;
}) {
  const { theme, width, portrait, accent } = ctx;
  if (items.length === 0) return null;
  const available = Math.max(120, footerTop - y);
  const out: ReactNode[] = [];

  if (portrait) {
    const gap = 18;
    const boxH = Math.max(86, Math.min(132, Math.floor((available - gap * (items.length - 1)) / items.length)));
    const bodyStart = items.length <= 4 ? 38 : 33;
    items.forEach((item, i) => {
      const boxY = y + i * (boxH + gap);
      const bottom = Math.min(boxY + boxH, footerTop);
      const label = numbered ? String(i + 1) : "•";
      const markerX = margin + 34;
      const textX = markerX + markerAdvance(ctx, 42, label);
      const textW = width - 2 * margin - 150;
      const fit = fitSize(item, textW, 2, bodyStart, 27);
      const textH = fit.lines * fit.size + Math.max(0, fit.lines - 1) * 6;
      out.push(
        <Panel key={`p${i}`} ctx={ctx} x={margin} y={boxY} w={width - 2 * margin} h={bottom - boxY} />,
        <Marker key={`m${i}`} ctx={ctx} x={markerX} y={boxY + Math.floor((boxH - 42) / 2)} size={42} label={label} color={accent} />,
        <Text key={`t${i}`} x={textX} y={boxY + Math.max(14, Math.floor((boxH - textH) / 2))} width={textW} size={fit.size} gap={6} color={theme.ink}>
          {item}
        </Text>,
      );
    });
    return <>{out}</>;
  }

  const columns = Math.max(1, items.length > 2 ? 2 : items.length);
  const rows = Math.ceil(items.length / columns);
  const gap = 18;
  const boxW = Math.floor((width - 2 * margin - gap * (columns - 1)) / columns);
  let boxH = Math.max(92, Math.floor((available - gap * (rows - 1)) / rows));
  if (compact) boxH = Math.min(boxH, 118);
  items.forEach((item, i) => {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = margin + col * (boxW + gap);
    const itemY = y + row * (boxH + gap);
    const label = numbered ? String(i + 1).padStart(2, "0") : "•";
    const textX = x + 24 + markerAdvance(ctx, 28, label);
    const textW = x + boxW - textX - 24;
    const fit = fitSize(item, textW, 3, 27, 20);
    out.push(
      <Panel key={`p${i}`} ctx={ctx} x={x} y={itemY} w={boxW} h={boxH} />,
      <Marker key={`m${i}`} ctx={ctx} x={x + 24} y={itemY + 18} size={28} label={label} color={accent} />,
      <Text key={`t${i}`} x={textX} y={itemY + 17} width={textW} size={fit.size} gap={4} color={theme.ink} bold>
        {item}
      </Text>,
    );
  });
  return <>{out}</>;
}

function Compare({ ctx, card, y, margin, footerTop }: { ctx: Ctx; card: Card; y: number; margin: number; footerTop: number }) {
  const { theme, width, portrait, accent } = ctx;
  const gap = portrait ? 24 : 28;
  const colW = Math.floor((width - 2 * margin - gap) / 2);
  const out: ReactNode[] = [];
  (["left", "right"] as const).forEach((key, col) => {
    const data = card[key] ?? { title: key === "left" ? "Left" : "Right", items: [] };
    const x = margin + col * (colW + gap);
    const color = col === 0 ? accent : theme.ink;
    out.push(
      <Panel key={`p${key}`} ctx={ctx} x={x} y={y} w={colW} h={footerTop - y} outline={Math.max(2, theme.visual.outline_width)} />,
      <div key={`b${key}`} style={abs({ left: x, top: y, width: colW, height: portrait ? 12 : 8, background: color })} />,
    );
    const title = fitSize(data.title, colW - 52, 2, portrait ? 48 : 30, portrait ? 30 : 22);
    let textY = y + (portrait ? 52 : 30);
    out.push(
      <Text key={`t${key}`} x={x + 28} y={textY} width={colW - 52} size={title.size} gap={6} color={theme.ink} bold>
        {data.title}
      </Text>,
    );
    textY += title.lines * (title.size + 6) + (portrait ? 28 : 12);
    const markerSize = portrait ? 14 : 11;
    data.items.forEach((item, i) => {
      const fit = fitSize(item, colW - 82, 3, portrait ? 36 : 24, portrait ? 25 : 18);
      const itemX = x + 30 + markerAdvance(ctx, markerSize, "");
      out.push(
        <Marker key={`m${key}${i}`} ctx={ctx} x={x + 30} y={textY + 10} size={markerSize} label="" color={color} />,
        <Text key={`i${key}${i}`} x={itemX} y={textY} width={x + colW - itemX - 24} size={fit.size} gap={6} color={theme.muted}>
          {item}
        </Text>,
      );
      textY += fit.lines * (fit.size + 6) + (portrait ? 22 : 10);
    });
  });
  return <>{out}</>;
}

function QuoteOrPrompt({ ctx, card, y, margin, footerTop, prompt }: {
  ctx: Ctx;
  card: Card;
  y: number;
  margin: number;
  footerTop: number;
  prompt: boolean;
}) {
  const { theme, width, portrait, accent } = ctx;
  const text = ((prompt ? card.prompt : card.quote) ?? "").trim() || card.subtitle.trim();
  const out: ReactNode[] = [
    <Panel key="panel" ctx={ctx} x={margin} y={y} w={width - 2 * margin} h={footerTop - y} outline={Math.max(2, theme.visual.outline_width)} />,
  ];
  let textY: number;
  let start: number;
  let min: number;
  let maxLines: number;
  if (prompt) {
    out.push(
      <Text key="label" x={margin + 36} y={y + 30} size={portrait ? 25 : 17} gap={0} color={accent} bold>
        COPY PROMPT
      </Text>,
    );
    textY = y + (portrait ? 92 : 60);
    [start, min, maxLines] = portrait ? [35, 23, 16] : [23, 16, 9];
  } else {
    out.push(
      <Text key="mark" x={margin + 30} y={y + 18} size={portrait ? 96 : 64} gap={0} color={accent} bold>
        “
      </Text>,
    );
    textY = y + (portrait ? 118 : 76);
    [start, min, maxLines] = portrait ? [54, 32, 10] : [34, 22, 6];
  }
  const textW = width - 2 * margin - 72;
  const fit = fitSize(text, textW, maxLines, start, min);
  const gap = portrait ? 10 : 5;
  out.push(
    <div
      key="body"
      style={abs({
        left: margin + 36,
        top: textY,
        width: textW,
        maxHeight: maxLines * (fit.size + gap),
        overflow: "hidden",
        fontSize: fit.size,
        lineHeight: `${fit.size + gap}px`,
        fontWeight: prompt ? 400 : 700,
        color: theme.ink,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      })}
    >
      {text}
    </div>,
  );
  const note = card.note?.trim();
  if (note) {
    const noteFit = fitSize(note, textW, 2, portrait ? 28 : 18, portrait ? 20 : 14);
    out.push(
      <Text key="note" x={margin + 36} y={footerTop - (portrait ? 88 : 48)} width={textW} size={noteFit.size} gap={4} color={theme.muted}>
        {note}
      </Text>,
    );
  }
  return <>{out}</>;
}

export function CardView({ file, index }: { file: CardsFile; index: number }) {
  const card = file.cards[index];
  const { width, height } = file.meta;
  const theme = CARD_THEMES[file.meta.theme] ?? CARD_THEMES.editorial;
  const portrait = height >= width;
  const accent = theme.accents[card.accent] ?? theme.accents.coral;
  const ctx: Ctx = { theme, width, height, portrait, accent };
  const v = theme.visual;

  const margin = Math.floor(width * (portrait ? 0.085 : 0.055) * v.margin_scale);
  const top = Math.floor(height * (portrait ? 0.075 : 0.08));
  const footerTop = height - Math.floor(height * (portrait ? 0.14 : 0.15));
  const cover = card.layout === "cover";
  const maxW = width - 2 * margin;

  // 标题区
  let y = top + (portrait ? 120 : 48);
  const [tStart, tMin, tLines] = portrait
    ? [Math.floor((cover ? 94 : 78) * v.title_scale), cover ? 60 : 50, cover ? 4 : 3]
    : [Math.floor((cover ? 58 : 50) * v.title_scale), cover ? 38 : 34, 2];
  const titleGap = portrait ? 14 : 6;
  const title = fitSize(card.title, maxW, tLines, tStart, tMin);
  const titleY = y;
  y += title.lines * (title.size + titleGap);
  const ruleY = y + (portrait ? 18 : 8);
  const ruleW = portrait ? 7 : 4;
  let rule: ReactNode = null;
  if (v.title_rule === "full") {
    rule = <div style={abs({ left: margin, top: ruleY, width: maxW, height: ruleW, background: accent })} />;
    y = ruleY + (portrait ? 42 : 18);
  } else if (v.title_rule === "none") {
    y += portrait ? 22 : 10;
  } else {
    rule = <div style={abs({ left: margin, top: ruleY, width: Math.floor(width * (portrait ? 0.2 : 0.12)), height: ruleW, background: accent })} />;
    y = ruleY + (portrait ? 42 : 18);
  }
  const subtitle = card.subtitle.trim();
  const subtitleY = y;
  const sub = subtitle
    ? fitSize(subtitle, maxW, portrait ? 3 : 2, portrait ? 42 : 25, portrait ? 30 : 20)
    : null;
  if (sub) y += sub.lines * (sub.size + (portrait ? 10 : 4));
  y += portrait ? 54 : 18;

  const footerY = height - Math.floor(height * (portrait ? 0.07 : 0.075));
  const footer = file.meta.footer || "内容整理｜请人工复核后发布";
  const footerFit = fitSize(footer, maxW, 2, portrait ? 28 : 17, portrait ? 18 : 13);
  const indexText = `${String(index + 1).padStart(2, "0")}/${String(file.cards.length).padStart(2, "0")}`;
  const indexSize = portrait ? 28 : 18;

  let body: ReactNode = null;
  if (card.layout === "cover" || card.layout === "list" || card.layout === "steps") {
    const items = (card.bullets ?? []).map((b) => b.trim()).filter(Boolean);
    body = <Bullets ctx={ctx} items={items} y={y} margin={margin} footerTop={footerTop} numbered={card.layout === "steps"} compact={cover} />;
  } else if (card.layout === "compare") {
    body = <Compare ctx={ctx} card={card} y={y} margin={margin} footerTop={footerTop} />;
  } else {
    body = <QuoteOrPrompt ctx={ctx} card={card} y={y} margin={margin} footerTop={footerTop} prompt={card.layout === "prompt"} />;
  }

  return (
    <div style={{ display: "flex", position: "relative", width, height, background: theme.background, fontFamily: FONT_FAMILY }}>
      <GridPattern ctx={ctx} />
      <Chrome ctx={ctx} />
      <Text x={margin} y={top} size={portrait ? 34 : 22} gap={0} color={accent} bold>
        {card.eyebrow}
      </Text>
      <Text x={width - margin - textWidth(indexText, indexSize)} y={top} size={indexSize} gap={0} color={theme.muted}>
        {indexText}
      </Text>
      <Text x={margin} y={titleY} width={maxW} size={title.size} gap={titleGap} color={theme.ink} bold>
        {card.title}
      </Text>
      {rule}
      {sub ? (
        <Text x={margin} y={subtitleY} width={maxW} size={sub.size} gap={portrait ? 10 : 4} color={theme.muted}>
          {subtitle}
        </Text>
      ) : null}
      {body}
      {v.footer_rule ? <div style={abs({ left: margin, top: footerY - 22, width: maxW, height: 2, background: theme.line })} /> : null}
      <Text x={margin} y={footerY} width={maxW} size={footerFit.size} gap={4} color={theme.muted}>
        {footer}
      </Text>
    </div>
  );
}

/** 一组卡片里用到的全部文字，用来向字体服务要子集 */
export function cardsText(file: CardsFile): string {
  const parts = [file.meta.footer, "内容整理｜请人工复核后发布", "0123456789/“•COPY PROMPTLeftRight"];
  for (const c of file.cards) {
    parts.push(c.eyebrow, c.title, c.subtitle, c.quote ?? "", c.note ?? "", c.prompt ?? "", ...(c.bullets ?? []));
    for (const col of [c.left, c.right]) if (col) parts.push(col.title, ...col.items);
  }
  return parts.join("");
}
