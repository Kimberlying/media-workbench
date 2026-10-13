import { describe, expect, it } from "vitest";
import { latestByPost, summarize } from "@/lib/analytics";
import { addDays, weekStart } from "@/lib/dates";

describe("周日历", () => {
  it("一周从周一开始", () => {
    expect(weekStart(new Date("2026-10-12T08:00:00Z"))).toBe("2026-10-12"); // 周一
    expect(weekStart(new Date("2026-10-18T23:00:00Z"))).toBe("2026-10-12"); // 周日
    expect(addDays("2026-10-12", 7)).toBe("2026-10-19");
  });
});

describe("复盘汇总", () => {
  it("每条帖子取最新快照再求和", () => {
    const m = (date: string, views: number) => ({ date, views, likes: 1, comments: 0, shares: 0, follows: 0 });
    const rows = latestByPost([
      { metrics: [m("2026-10-10", 10), m("2026-10-11", 50)] },
      { metrics: [] },
    ]);
    expect(rows.map((r) => r.latest.views)).toEqual([50, 0]);
    expect(summarize(rows.map((r) => r.latest))).toEqual({ views: 50, likes: 1, comments: 0, shares: 0, follows: 0 });
  });
});
