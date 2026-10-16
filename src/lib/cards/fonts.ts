// 卡片用的中文字体：向 Google Fonts 只要这组卡片用到的字（text= 子集），几十 KB，不用把整套字体放进仓库。
// 不带浏览器 UA 请求时，Google Fonts 返回 Satori 能读的 TTF。

export interface CardFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
}

const FAMILY = "Noto Sans SC";

async function fetchSubset(weight: 400 | 700, text: string, doFetch: typeof fetch): Promise<ArrayBuffer> {
  const css = await doFetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FAMILY)}:wght@${weight}&text=${encodeURIComponent(text)}`,
  );
  if (!css.ok) throw new Error(`取字体失败：Google Fonts 返回 ${css.status}`);
  const url = (await css.text()).match(/src:\s*url\(([^)]+)\)/)?.[1];
  if (!url) throw new Error("取字体失败：Google Fonts 没有返回字体地址");
  const font = await doFetch(url);
  if (!font.ok) throw new Error(`取字体失败：字体文件返回 ${font.status}`);
  return font.arrayBuffer();
}

export async function loadCardFonts(text: string, doFetch: typeof fetch = fetch): Promise<CardFont[]> {
  const chars = [...new Set(text.replace(/\s/g, ""))].join("");
  const [regular, bold] = await Promise.all([fetchSubset(400, chars, doFetch), fetchSubset(700, chars, doFetch)]);
  return [
    { name: FAMILY, data: regular, weight: 400, style: "normal" },
    { name: FAMILY, data: bold, weight: 700, style: "normal" },
  ];
}
