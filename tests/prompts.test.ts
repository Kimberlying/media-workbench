import { describe, expect, it } from "vitest";
import type { AccountProfile } from "@/lib/db/types";
import { getFormat } from "@/lib/content/formats";
import { buildCopyPrompt } from "@/lib/pipeline/copywriting";

const profile: AccountProfile = {
  id: "p",
  org_id: "o",
  positioning: "AI 工具实测",
  audience: "独立开发者",
  tone: "直接、有观点",
  taboo: ["稳赚"],
  benchmarks: [],
  language: "zh-CN",
};

describe("文案提示词", () => {
  it("带上账号档案、知识库禁用词和平台格式要求", () => {
    const [system, user] = buildCopyPrompt(
      { title: "新模型发布", angle: "对比上一代" },
      { handle: "kim" },
      profile,
      { toneGuides: ["少用感叹号"], tabooWords: ["内幕"], viralExamples: [] },
      getFormat("x.thread"),
    );
    expect(system.content).toContain("@kim");
    expect(system.content).toContain("少用感叹号");
    expect(system.content).toContain("稳赚、内幕");
    expect(user.content).toContain("---");
  });
});
