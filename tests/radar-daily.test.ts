import { describe, expect, it, vi } from "vitest";
import { buildRewritePrompt } from "@/lib/content/x-post";
import { discordMessages, sendDiscord } from "@/lib/notify/discord";
import { buildDigest, dayRange, digestDay, materialOf, pickDaily } from "@/lib/radar/daily";

const n = (id: string, source: string, heat: number, tags: string[] = []) => ({
  id,
  source,
  title: `标题 ${id}`,
  summary: `摘要 ${id}`,
  url: `https://e.com/${id}`,
  tags,
  heat,
});

describe("今日 3 条", () => {
  it("洞察、实用、产品各挑热度最高的一条", () => {
    const news = [
      n("hn", "Hacker News", 300),
      n("gh", "GitHub Trending", 900),
      n("gh2", "GitHub Trending", 800),
      n("ph", "Product Hunt", 100),
      n("x", "x", 0),
    ];
    expect(pickDaily(news).map((i) => i.id)).toEqual(["hn", "gh", "ph"]);
  });

  it("某个方向没有就按热度补齐", () => {
    const news = [n("gh", "GitHub Trending", 900), n("gh2", "GitHub Trending", 800), n("x", "x", 0)];
    expect(pickDaily(news).map((i) => i.id)).toEqual(["gh", "gh2", "x"]);
  });

  it("资讯点评的提示词带原文链接，素材当数据", () => {
    const msgs = buildRewritePrompt({ mode: "news", material: materialOf(n("a", "HN", 1)), handle: "kim", tone: "" });
    expect(msgs[0].content).toContain("原文链接");
    expect(msgs[1].content).toContain("链接：https://e.com/a");
    expect(msgs[1].content).toMatch(/^<material>/);
  });
});

describe("日报", () => {
  it("按北京时间切日", () => {
    expect(digestDay(new Date("2026-10-12T17:00:00Z"))).toBe("2026-10-13");
    expect(dayRange("2026-10-13")).toEqual(["2026-10-12T16:00:00.000Z", "2026-10-13T16:00:00.000Z"]);
  });

  it("分三份：素材、推文、利他", () => {
    const news = [n("a", "Hacker News", 10), n("b", "Product Hunt", 50, ["利他"])];
    const d = buildDigest("2026-10-13", news, [{ handle: "kim", body: "推文正文", news: news[0] }]);
    expect(d.top.map((i) => i.id)).toEqual(["b", "a"]);
    expect(d.radar).toContain("## Hacker News");
    expect(d.posts).toContain("推文正文");
    expect(d.posts).toContain("@kim");
    expect(d.altruism).toContain("标题 b");
    expect(d.altruism).not.toContain("标题 a");
  });

  it("Discord：一张 TOP 5 卡片，每条推文一张", async () => {
    const news = [n("a", "Hacker News", 10)];
    const posts = [{ handle: "kim", body: "推文正文", news: news[0] }];
    const msgs = discordMessages(buildDigest("2026-10-13", news, posts), posts);
    expect(msgs).toHaveLength(2);

    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await sendDiscord("https://discord/hook", msgs, fetch)).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
