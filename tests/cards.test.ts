import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadCardFonts } from "@/lib/cards/fonts";
import { cardsText, countLines, fitSize } from "@/lib/cards/layout";
import { renderCard } from "@/lib/cards/render";
import { packCards } from "@/lib/xhs/export";
import type { CardsFile } from "@/lib/xhs/schema";

const file: CardsFile = {
  meta: { title: "t", width: 1080, height: 1800, theme: "editorial", footer: "@kim" },
  cards: [
    { file: "01.png", layout: "cover", eyebrow: "AI", title: "Cover", subtitle: "sub", accent: "coral", bullets: ["a", "b"] },
    { file: "02.png", layout: "compare", eyebrow: "", title: "VS", subtitle: "", accent: "blue", left: { title: "L", items: ["x"] }, right: { title: "R", items: ["y"] } },
    { file: "03.png", layout: "quote", eyebrow: "", title: "", subtitle: "", accent: "gold", quote: "q", note: "n" },
  ],
};

// next/og 自带的拉丁字体，测试里替代中文字体，不走网络
const geist = readFileSync("node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf");
const fonts = [400, 700].map((weight) => ({
  name: "Noto Sans SC",
  data: geist.buffer.slice(geist.byteOffset, geist.byteOffset + geist.byteLength) as ArrayBuffer,
  weight: weight as 400 | 700,
  style: "normal" as const,
}));

function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("卡片出图", () => {
  it("中文按一个字号宽估算行数，放不下时缩小字号", () => {
    expect(countLines("一二三四五", 100, 300)).toBe(2);
    expect(countLines("abc\ndef", 10, 300)).toBe(2);
    expect(fitSize("一二三四五六", 300, 1, 100, 40)).toEqual({ size: 50, lines: 1 });
    expect(fitSize("一二三四五六", 300, 1, 100, 90).size).toBe(90);
  });

  it("按卡片尺寸出 PNG，竖版横版都行", { timeout: 30_000 }, async () => {
    for (let i = 0; i < file.cards.length; i++) {
      const png = await renderCard(file, i, fonts);
      expect(Array.from(png.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);
      expect(pngSize(png)).toEqual({ width: 1080, height: 1800 });
    }
    const wide = { ...file, meta: { ...file.meta, width: 1200, height: 675, theme: "business" as const } };
    expect(pngSize(await renderCard(wide, 1, fonts))).toEqual({ width: 1200, height: 675 });
  });

  it("只向字体服务要用到的字，正常体和粗体各一次", async () => {
    const fetch = vi.fn(async (url: string) =>
      url.startsWith("https://fonts.googleapis.com")
        ? new Response("@font-face { src: url(https://fonts.gstatic.com/x.ttf) format('truetype'); }")
        : new Response(new Uint8Array([1, 2, 3])),
    );
    const loaded = await loadCardFonts("你好 你好", fetch as unknown as typeof globalThis.fetch);
    const cssCalls = fetch.mock.calls.map(([u]) => u).filter((u) => u.includes("googleapis"));
    expect(cssCalls).toHaveLength(2);
    expect(decodeURIComponent(cssCalls[0])).toContain("text=你好");
    expect(loaded.map((f) => f.weight)).toEqual([400, 700]);
    expect(cardsText(file)).toContain("Cover");
  });

  it("X 长文没有贴图，不出图", () => {
    expect(packCards({ kind: "longform", title: "t", graphics: null, checks: [] })).toBeNull();
    expect(packCards({ kind: "longform", title: "t", graphics: file, checks: [] })).toBe(file);
  });
});
