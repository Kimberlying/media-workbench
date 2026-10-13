import { describe, expect, it, vi } from "vitest";
import { getConnector, splitThread } from "@/lib/connectors";

describe("连接器", () => {
  it("推文串按单独一行 --- 切分", () => {
    expect(splitThread("第一条\n---\n第二条\n\n  ---  \n第三条\n---\n")).toEqual([
      "第一条",
      "第二条",
      "第三条",
    ]);
  });

  it("X 发推文串时后一条回复前一条，返回第一条的 id", async () => {
    let n = 0;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { id: `t${++n}` } })));
    const result = await getConnector("x").publish({ body: "一\n---\n二" }, { accessToken: "tok", fetch });

    expect(result).toEqual({ method: "api", platformPostId: "t1" });
    const bodies = fetch.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies).toEqual([{ text: "一" }, { text: "二", reply: { in_reply_to_tweet_id: "t1" } }]);
  });

  it("X 取数换算成统一指标", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "t1",
                public_metrics: { impression_count: 900, like_count: 30, reply_count: 4, retweet_count: 5, quote_count: 1 },
              },
            ],
          }),
        ),
    );
    const metrics = await getConnector("x").fetchMetrics(["t1"], { accessToken: "tok", fetch });
    expect(metrics.get("t1")).toEqual({ views: 900, likes: 30, comments: 4, shares: 6, follows: 0 });
  });

  it("小红书生成发布包，不调用任何接口", async () => {
    const result = await getConnector("xiaohongshu").publish({ body: "标题\n正文 #旅行 #攻略" }, { accessToken: null });
    expect(result).toEqual({
      method: "manual",
      package: { platform: "xiaohongshu", text: "标题\n正文 #旅行 #攻略", mediaUrls: [], hashtags: ["旅行", "攻略"] },
    });
  });
});
