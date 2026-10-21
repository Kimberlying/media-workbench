import { describe, expect, it } from "vitest";
import { parseBuilderBlogs, parseBuilderPodcasts, parseBuilderTweets } from "@/lib/radar/follow-builders";

describe("follow-builders 信源", () => {
  it("X builder：每人取最热一条，去掉 t.co 短链，太短的跳过，按热度排", () => {
    const json = JSON.stringify({
      x: [
        {
          name: "Swyx",
          handle: "swyx",
          tweets: [
            { text: "short", url: "https://x.com/swyx/1", likes: 999 },
            { text: "opus is great for writing long docs https://t.co/abc", url: "https://x.com/swyx/2", likes: 36, retweets: 3, replies: 36 },
            { text: "codex made an animated explainer video", url: "https://x.com/swyx/3", likes: 4 },
          ],
        },
        {
          name: "Karpathy",
          tweets: [{ text: "new nanochat release with a training guide", url: "https://x.com/k/1", likes: 5000, retweets: 400 }],
        },
        { name: "Quiet", tweets: [] },
      ],
    });
    const out = parseBuilderTweets(json, 6);
    expect(out.map((i) => [i.url, i.heat])).toEqual([
      ["https://x.com/k/1", 6200],
      ["https://x.com/swyx/2", 117],
    ]);
    expect(out[1].title).toBe("Swyx：opus is great for writing long docs");
    expect(out[1].source).toBe("X Builders");
    expect(parseBuilderTweets(json, 1)).toHaveLength(1);
  });

  it("播客：标题带节目名，摘要取文字稿开头", () => {
    const json = JSON.stringify({
      podcasts: [
        { name: "Latent Space", title: "Evals in 2026", url: "https://youtube.com/watch?v=1", transcript: "Welcome back.\n" + "x".repeat(300) },
        { name: "No URL", title: "skip" },
      ],
    });
    const out = parseBuilderPodcasts(json, 2, 300);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Latent Space：Evals in 2026", heat: 300, source: "Builder 播客" });
    expect(out[0].summary.startsWith("Welcome back.")).toBe(true);
    expect(out[0].summary.length).toBeLessThanOrEqual(160);
  });

  it("官方博客：信源名用博客名，摘要优先 description", () => {
    const json = JSON.stringify({
      blogs: [
        { name: "Anthropic Engineering", title: "Building agents", url: "https://anthropic.com/engineering/a", description: "How we <b>build</b> agents", content: "long" },
        { name: "Claude Blog", title: "Skills", url: "https://claude.com/blog/s", content: "Skills are folders" },
      ],
    });
    const out = parseBuilderBlogs(json, 3, 400);
    expect(out.map((i) => [i.source, i.summary])).toEqual([
      ["Anthropic Engineering", "How we build agents"],
      ["Claude Blog", "Skills are folders"],
    ]);
  });

  it("上游暂时为空时返回空", () => {
    expect(parseBuilderPodcasts(JSON.stringify({ podcasts: [] }), 2, 300)).toEqual([]);
    expect(parseBuilderBlogs("{}", 3, 400)).toEqual([]);
  });
});
