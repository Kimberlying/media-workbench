import { describe, expect, it } from "vitest";
import { RADAR_SOURCES, xSearchTool } from "@/lib/pipeline/radar";

describe("资讯雷达", () => {
  it("只搜 X", () => {
    expect(RADAR_SOURCES.map((s) => s.source)).toEqual(["x"]);
  });

  it("X 搜索限定在昨天到今天（to_date 不含）", () => {
    expect(xSearchTool(new Date("2026-10-13T23:30:00Z"))).toEqual({
      type: "x_search",
      from_date: "2026-10-12",
      to_date: "2026-10-14",
    });
  });
});
