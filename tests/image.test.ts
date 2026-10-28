import { describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_MODEL, generateImage, imageGenerator, imagePrompt } from "@/lib/media/image";

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

  it("选 ChatGPT 时调 OpenAI 图片接口，横图，取 b64_json", async () => {
    let req: { url: string; body: Record<string, unknown>; auth: string } | undefined;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      req = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization };
      return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }));
    });
    const generate = imageGenerator("openai", { OPENAI_API_KEY: "sk" }, fetch as unknown as typeof globalThis.fetch)!;
    const image = await generate("p");
    expect(req?.url).toBe("https://api.openai.com/v1/images/generations");
    expect(req?.auth).toBe("Bearer sk");
    expect(req?.body).toMatchObject({ model: "gpt-image-2", size: "1536x1024", prompt: "p" });
    expect([...image.bytes]).toEqual([1, 2, 3]);
  });

  it("不出图返回 null；选了 ChatGPT 没配 key 时说清楚", () => {
    expect(imageGenerator("off", {})).toBeNull();
    expect(() => imageGenerator("openai", {})).toThrow("OPENAI_API_KEY");
    expect(imageGenerator("gemini", { GEMINI_API_KEY: "g" })).toBeTypeOf("function");
  });
});
