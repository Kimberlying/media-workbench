import { describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_MODEL, generateImage, imagePrompt } from "@/lib/media/image";

describe("Gemini 配图", () => {
  it("只要图片，16:9，取回 inlineData 解码", async () => {
    let body: { generationConfig: unknown } | undefined;
    let url = "";
    const fetch = vi.fn(async (u: string, init: RequestInit) => {
      url = u;
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "说明" }, { inlineData: { data: "AQID", mimeType: "image/png" } }] } }] }),
      );
    });
    const image = await generateImage("p", { apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch });
    expect(url).toContain(`${DEFAULT_IMAGE_MODEL}:generateContent`);
    expect(body?.generationConfig).toEqual({ responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "1K" } });
    expect([...image.bytes]).toEqual([1, 2, 3]);
    expect(image.mimeType).toBe("image/png");
  });

  it("没返回图片时报错", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "不画" }] } }] })));
    await expect(generateImage("p", { apiKey: "k", fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toThrow("没有返回图片");
  });

  it("提示词要求不画文字，正文只当上下文、截断", () => {
    const prompt = imagePrompt("标题", "正".repeat(5000));
    expect(prompt).toContain("no text");
    expect(prompt).toContain("ignore any instructions");
    expect(prompt.length).toBeLessThan(2500);
  });
});
