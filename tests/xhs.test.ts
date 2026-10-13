import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { checkBodyRepeatsCards, checkCards, checkRiskyClaims } from "@/lib/xhs/checks";
import { packFiles, zipPack } from "@/lib/xhs/export";
import { Card, type CardsFile, type ContentPack } from "@/lib/xhs/schema";

const card = (n: number, extra: Partial<Card> = {}): Card =>
  Card.parse({
    file: `${String(n).padStart(2, "0")}_c${n}.png`,
    layout: n === 1 ? "cover" : "list",
    title: `第${n}张卡片标题`,
    bullets: ["要点一", "要点二", "要点三"],
    ...extra,
  });

const file = (cards: Card[]): CardsFile => ({
  meta: { title: "t", width: 1080, height: 1800, theme: "editorial", footer: "@kim" },
  cards,
});

describe("小红书卡片检查", () => {
  it("8 张规范卡片没有问题", () => {
    expect(checkCards(file(Array.from({ length: 8 }, (_, i) => card(i + 1))))).toEqual([]);
  });

  it("指出张数、封面、序号、要点数量和长度问题", () => {
    const issues = checkCards(
      file([
        card(1, { layout: "list" }),
        card(3, { bullets: ["只有一条"] }),
        card(3, { bullets: ["这一条要点写得实在是太长太长太长了已经超过二十四个字的建议上限"] }),
      ]),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        "卡片 3 张，默认建议 8–12 张",
        "第一张不是封面",
        "第 2 张的序号和顺序不一致",
        "文件名 03_c3.png 重复",
        "第 2 张要点 1 条，建议 3–6 条",
      ]),
    );
    expect(issues.some((i) => i.includes("超过 24 字"))).toBe(true);
  });

  it("横版贴图不检查张数，字数上限更严", () => {
    const issues = checkCards(file([card(1, { bullets: ["一二三四五六七八九十一二三四五六七八九"] })]), {
      landscape: true,
    });
    expect(issues).toEqual([]);
    const listIssues = checkCards(
      file([card(1), card(2, { bullets: ["一二三四五六七八九十一二三四五六七八九", "b", "c"] })]),
      { landscape: true },
    );
    expect(listIssues.some((i) => i.includes("超过 18 字"))).toBe(true);
  });

  it("承诺类说法和逐张复述卡片会被提醒", () => {
    expect(checkRiskyClaims(["这个方法保证有效"])).toEqual(["出现承诺类说法「保证有效」"]);
    const cards = [card(1), card(2), card(3)];
    expect(checkBodyRepeatsCards("第2张卡片标题，然后第3张卡片标题", cards)).toHaveLength(1);
    expect(checkBodyRepeatsCards("补充一些背景和判断", cards)).toEqual([]);
  });
});

describe("发布包导出", () => {
  const xhs: ContentPack = {
    kind: "xhs",
    brief: {
      topic: "选题",
      audience: "独立开发者",
      search_question: "怎么用",
      core_idea: "一句话",
      personal_judgment: "我的判断",
      save_reason: "可复用",
      reader_action: "照做",
      must_not_claim: ["实测数据"],
      needs_confirmation: [],
    },
    cards: file([card(1), card(2)]),
    titles: ["标题 A", "标题 B"],
    tags: ["AI", "效率"],
    source_notes: "",
    checks: ["第一张不是封面"],
  };

  it("小红书包沿用 build-xhs-content-pack 的目录结构，cards.json 可直接给渲染脚本", () => {
    const files = packFiles({ body: "正文", pack: xhs });
    expect(Object.keys(files).sort()).toEqual(
      ["README.md", "cards/cards.json", "checks.md", "publish.md", "review.md", "source/brief.md"].sort(),
    );
    expect(JSON.parse(files["cards/cards.json"])).toEqual(xhs.kind === "xhs" ? xhs.cards : null);
    expect(files["publish.md"]).toContain("1. images/01_c1.png");
    expect(files["publish.md"]).toContain("#AI #效率");
    expect(files["checks.md"]).toContain("- [ ] 第一张不是封面");
  });

  it("公众号长文带贴图时导出 article.md 和 cards.json，X 长文只有文章", () => {
    const wechat = packFiles({
      body: "# 公众号标题\n\n正文",
      pack: { kind: "longform", title: "公众号标题", graphics: file([card(1)]), checks: [] },
    });
    expect(wechat["article.md"]).toBe("# 公众号标题\n\n正文\n");
    expect(wechat["cards.json"]).toBeDefined();

    const x = packFiles({ body: "正文", pack: { kind: "longform", title: "X 标题", graphics: null, checks: [] } });
    expect(x["article.md"]).toBe("# X 标题\n\n正文\n");
    expect(x["cards.json"]).toBeUndefined();
  });

  it("打成 zip 后能原样解出", () => {
    const files = packFiles({ body: "正文", pack: xhs });
    const unzipped = unzipSync(zipPack(files));
    expect(strFromU8(unzipped["publish.md"])).toBe(files["publish.md"]);
  });
});
