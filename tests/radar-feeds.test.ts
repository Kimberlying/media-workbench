import { describe, expect, it } from "vitest";
import {
  FEEDS,
  matchesAny,
  parseAtom,
  parseBuzzing,
  parseGithubTrending,
  parseRss,
} from "@/lib/radar/feeds";
import { classify, dedupe, duplicateReason, isAltruism, normalizeUrl, TAG_ANTI_HYPE } from "@/lib/radar/filters";
import { fetchFeeds } from "@/lib/pipeline/radar";

const item = (title: string, url = `https://e.com/${encodeURIComponent(title)}`, summary = "", heat = 100) => ({
  source: "t",
  title,
  url,
  summary,
  heat,
});

describe("固定信源解析", () => {
  it("Buzzing：只留 AI 相关，从摘要里读热度", () => {
    const json = JSON.stringify({
      items: [
        { title: "A new LLM agent", summary: "↑ 1,234 HN Points", url: "https://a" },
        { title: "Gardening tips", summary: "said nothing", url: "https://b" },
        { title: "Chrome 插件", summary: "2.5K Reddit Upvotes", url: "https://c" },
      ],
    });
    const out = parseBuzzing(json, "HN", 5);
    expect(out.map((i) => [i.url, i.heat])).toEqual([
      ["https://a", 1234],
      ["https://c", 2500],
    ]);
  });

  it("英文关键词按整词匹配", () => {
    expect(matchesAny("she said hi", ["ai"])).toBe(false);
    expect(matchesAny("new AI tool", ["ai"])).toBe(true);
    expect(matchesAny("开源模型", ["模型"])).toBe(true);
  });

  it("Atom：跳过每日讨论帖", () => {
    const xml = `<feed><entry><title>Daily Discussion</title><link href="https://r/1"/></entry>
      <entry><title>Qwen 4 &amp; local</title><link href="https://r/2"/><content type="html">&lt;p&gt;runs on 24GB&lt;/p&gt;</content></entry></feed>`;
    expect(parseAtom(xml, "r/LocalLLaMA", 5, 150)).toEqual([
      { source: "r/LocalLLaMA", title: "Qwen 4 & local", summary: "runs on 24GB", url: "https://r/2", heat: 150 },
    ]);
  });

  it("RSS：可按关键词筛", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Cloudflare 免费教程]]></title><link>https://ns/1</link><description>x</description></item>
      <item><title>出一台闲置手机</title><link>https://ns/2</link></item></channel></rss>`;
    expect(parseRss(xml, "NodeSeek", 3, 350, ["cloudflare"]).map((i) => i.url)).toEqual(["https://ns/1"]);
  });

  it("GitHub Trending：仓库名、描述和今日星数", () => {
    const html = `<article class="Box-row"><h2 class="h3"><a href="/foo/bar-ai">foo / bar</a></h2>
      <p class="col-9 color-fg-muted my-1">Local agent runner</p><span>1,024 stars today</span></article>`;
    expect(parseGithubTrending(html, 5)).toEqual([
      {
        source: "GitHub Trending",
        title: "foo/bar-ai（今日 +1,024★）",
        summary: "Local agent runner",
        url: "https://github.com/foo/bar-ai",
        heat: 1536,
      },
    ]);
  });

  it("单个信源失败不影响其他", async () => {
    const out = await fetchFeeds(async (url) => {
      if (url.includes("hn.buzzing")) throw new Error("down");
      if (url.includes("ph.buzzing")) return JSON.stringify({ items: [{ title: "AI app", url: "https://ph/1" }] });
      return null;
    });
    expect(out.map((i) => i.url)).toEqual(["https://ph/1"]);
    expect(FEEDS).toHaveLength(8);
  });
});

describe("分类", () => {
  it("利他：黑名单优先，再看强特征词（用的是 kim 原脚本里的测试例子）", () => {
    for (const t of ["食品加工会影响新陈代谢和大脑活动", "PS5的越狱活动正迅速蔓延", "收一张联通卡"]) {
      expect(isAltruism(item(t))).toBe(false);
    }
    for (const t of [
      "Google AI Studio 提供每日 1500 次完全免费额度",
      "分享一个高质量开源平替 Cursor 的代码生成工具",
      "Devpost 举办全球 AI 黑客松活动，参赛送 $500 算力补贴",
    ]) {
      expect(isAltruism(item(t))).toBe(true);
    }
  });

  it("清醒剂", () => {
    expect(classify(item("AI startup bubble is bursting"))).toEqual([TAG_ANTI_HYPE]);
    expect(classify(item("新模型发布"))).toEqual([]);
  });
});

describe("去重", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();

  it("链接规范化", () => {
    expect(normalizeUrl("https://www.Example.com/a/?utm=1")).toBe("example.com/a");
  });

  it("14 天内同一链接挡掉", () => {
    const seen = [{ title: "旧标题", url: "http://e.com/x/", fetched_at: daysAgo(10) }];
    expect(duplicateReason(item("新标题", "https://e.com/x?ref=1"), seen, now)).toBe("14 天内链接相同");
  });

  it("3 天内标题包含挡掉，超过 3 天放行", () => {
    const seen = [{ title: "三天内下载量突破1000次", url: "https://a", fetched_at: daysAgo(2) }];
    expect(duplicateReason(item("三天内下载量突破1000次，开源替代方案", "https://b"), seen, now)).toBe("3 天内标题重合");
    seen[0].fetched_at = daysAgo(5);
    expect(duplicateReason(item("三天内下载量突破1000次，开源替代方案", "https://b"), seen, now)).toBeNull();
  });

  it("3 天内核心词重合 3 个以上挡掉", () => {
    const seen = [{ title: "Qwen4 runs llama.cpp vllm", url: "https://a", fetched_at: daysAgo(1) }];
    expect(duplicateReason(item("Benchmark: qwen4 on llama.cpp and vllm", "https://b"), seen, now)).toBe("3 天内核心词重合");
  });

  it("同一批里热度高的留下", () => {
    const out = dedupe([item("Same story", "https://a", "", 10), item("Same story", "https://b", "", 99)], [], now);
    expect(out.map((i) => i.url)).toEqual(["https://b"]);
  });
});
