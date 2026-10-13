import { describe, expect, it } from "vitest";
import { checkTabooWords, parseTabooList } from "@/lib/content/compliance";

describe("禁用词检查", () => {
  it("找出命中的词，忽略大小写并去重", () => {
    const result = checkTabooWords("这个 Crypto 项目稳赚不赔", ["crypto", "稳赚", "crypto", " "]);
    expect(result).toEqual({ ok: false, hits: ["crypto", "稳赚"] });
  });

  it("没有命中时通过", () => {
    expect(checkTabooWords("正常内容", ["稳赚"]).ok).toBe(true);
  });

  it("词表支持换行、中英文逗号和顿号分隔", () => {
    expect(parseTabooList("稳赚,保本，内幕、\n暴富\n")).toEqual(["稳赚", "保本", "内幕", "暴富"]);
  });
});
