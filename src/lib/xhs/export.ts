import { strToU8, zipSync } from "fflate";
import type { ContentPack } from "./schema";

// 把内容包导出成 build-xhs-content-pack 的目录结构，下载后可以直接用它的脚本出图：
//   python3 scripts/render_cards.py cards/cards.json --output-dir images

const RENDER_HELP = (cardsPath: string, imagesDir: string) =>
  [
    "# 出图",
    "",
    "图片用 build-xhs-content-pack 的渲染脚本生成（需要 Python 和 Pillow）：",
    "",
    "```bash",
    "git clone https://github.com/Kimberlying/build-xhs-content-pack",
    "cd build-xhs-content-pack/skills/build-xhs-content-pack",
    "python3 -m pip install -r scripts/requirements.txt",
    `python3 scripts/render_cards.py <本目录>/${cardsPath} --output-dir <本目录>/${imagesDir}`,
    "```",
    "",
    "换风格：加 `--theme reading-card`（可选 editorial、reading-card、tech-tutorial、business）。",
    "",
  ].join("\n");

const REVIEW_TEMPLATE = `# 发布后复盘

发布日期：
曝光/阅读：
点赞：
收藏：
评论：
转发：
读者反复提问：
最值得保留的卡片：
需要重写的部分：
下一篇的假设：
`;

const checklist = (items: string[]) =>
  items.length ? items.map((i) => `- [ ] ${i}`).join("\n") : "- 自动检查没有发现问题";

export function packFiles(input: { body: string; pack: ContentPack }): Record<string, string> {
  const { body, pack } = input;

  if (pack.kind === "xhs") {
    const b = pack.brief;
    return {
      "source/brief.md": [
        `选题：${b.topic}`,
        `目标读者：${b.audience}`,
        `搜索问题：${b.search_question}`,
        `核心观点：${b.core_idea}`,
        `个人判断：${b.personal_judgment}`,
        `收藏理由：${b.save_reason}`,
        `读者行动：${b.reader_action}`,
        `不能编造：${b.must_not_claim.join("；")}`,
        `需要人工确认：${b.needs_confirmation.join("；")}`,
        "",
      ].join("\n"),
      "cards/cards.json": JSON.stringify(pack.cards, null, 2) + "\n",
      "publish.md": [
        "# 标题备选",
        "",
        ...pack.titles.map((t, i) => `${i + 1}. ${t}`),
        "",
        "# 图片上传顺序",
        "",
        ...pack.cards.cards.map((c, i) => `${i + 1}. images/${c.file}`),
        "",
        "# 发布正文",
        "",
        body,
        "",
        "# 标签",
        "",
        pack.tags.map((t) => `#${t}`).join(" "),
        "",
        "# 资料与声明",
        "",
        pack.source_notes || "（无）",
        "",
        "# 发布前人工确认",
        "",
        "- [ ] 图片顺序、封面在手机上清楚可读",
        "- [ ] 事实、数据和引用已核对",
        "- [ ] 发布设置（话题、地点、可见范围）已确认",
        "",
      ].join("\n"),
      "checks.md": `# 自动检查\n\n${checklist(pack.checks)}\n`,
      "review.md": REVIEW_TEMPLATE,
      "README.md": RENDER_HELP("cards/cards.json", "images"),
    };
  }

  const files: Record<string, string> = {
    "article.md": body.startsWith("# ") ? `${body}\n` : `# ${pack.title}\n\n${body}\n`,
    "checks.md": `# 自动检查\n\n${checklist(pack.checks)}\n`,
    "review.md": REVIEW_TEMPLATE,
  };
  if (pack.graphics && pack.graphics.cards.length > 0) {
    files["cards.json"] = JSON.stringify(pack.graphics, null, 2) + "\n";
    files["README.md"] = RENDER_HELP("cards.json", "images");
  }
  return files;
}

export function zipPack(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])));
}
