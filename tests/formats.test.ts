import { describe, expect, it } from "vitest";
import { publishesViaApi } from "@/lib/connectors";
import { formatOfVariant, formatsFor, getFormat, variantOf } from "@/lib/content/formats";

describe("内容形式", () => {
  it("X 有推文串和长文两种形式，推文串排第一", () => {
    expect(formatsFor("x").map((f) => f.id)).toEqual(["x.thread", "x.article"]);
    expect(formatsFor("wechat").map((f) => f.id)).toEqual(["wechat.article"]);
  });

  it("variant 和形式可以互相换算", () => {
    const spec = getFormat("wechat.article");
    expect(variantOf(spec, "zh-CN")).toBe("wechat:zh-CN:article");
    expect(formatOfVariant("wechat:zh-CN:article")).toBe(spec);
  });

  it("只有 X 推文串走 API 自动发布，X 长文、公众号、小红书出发布包", () => {
    expect(publishesViaApi("x", "x:zh-CN:thread")).toBe(true);
    expect(publishesViaApi("x", "x:zh-CN:article")).toBe(false);
    expect(publishesViaApi("wechat", "wechat:zh-CN:article")).toBe(false);
    expect(publishesViaApi("xiaohongshu", "xiaohongshu:zh-CN:pack")).toBe(false);
    expect(publishesViaApi("x", "x:zh-CN:unknown")).toBe(false);
  });
});
