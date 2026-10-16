import { ImageResponse } from "next/og";
import type { CardsFile } from "@/lib/xhs/schema";
import { loadCardFonts, type CardFont } from "./fonts";
import { CardView, cardsText } from "./layout";

// 在工作台里直接把 cards.json 出成 PNG（二期：视觉生成）。版式与 build-xhs-content-pack 的 render_cards.py 一致。

export async function renderCard(file: CardsFile, index: number, fonts?: CardFont[]): Promise<Uint8Array> {
  const res = new ImageResponse(<CardView file={file} index={index} />, {
    width: file.meta.width,
    height: file.meta.height,
    fonts: fonts ?? (await loadCardFonts(cardsText(file))),
  });
  return new Uint8Array(await res.arrayBuffer());
}

/** 整组卡片，字体只取一次；返回 文件名 → PNG */
export async function renderCards(file: CardsFile): Promise<Record<string, Uint8Array>> {
  const fonts = await loadCardFonts(cardsText(file));
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < file.cards.length; i++) out[file.cards[i].file] = await renderCard(file, i, fonts);
  return out;
}
