# 自媒体工作台

从选题到复盘的一站式内容工作台：资讯进来，内容出去，数据回流。AI 负责效率，人负责品质。

这是一期（自用 MVP）的代码骨架，按[项目设计文档](https://claude.ai/code/artifact/78f5629d-d472-4fad-99a7-3faafcbd03d9)搭建。一期只服务自己的账号，但多租户和计量从第一天就打好底：组织 → 工作区 → 账号，所有业务表按组织做行级隔离，每次模型调用都记用量。

## 一期包含什么

| 模块 | 做什么 | 代码 |
| --- | --- | --- |
| 资讯雷达 | 每天 7 点（北京时间）两路入共享资讯池：8 个固定信源（Product Hunt、r/SideProject、Hacker News、r/LocalLLaMA、GitHub Trending、NodeSeek、阮一峰周刊、Godly，搬自 kim 原来的 `fetch_ai_radar.py`），加 Grok 按账号档案实时搜 X（`x_search`）。入库前去重（14 天同链接、3 天同标题或核心词），并打「利他」「清醒」标签 | `src/lib/radar/`、`src/lib/pipeline/radar.ts` |
| 今日 3 条与日报 | 资讯入库后，按洞察、实用、产品三个方向各挑一条，给每个 X 账号写成短推草稿（只生成不发）；热度前 5 和这 3 条推到 Discord（`DISCORD_WEBHOOK_URL`）；`/api/digest` 出日报，Mac 上的 `scripts/obsidian_sync.py` 每天拉下来写进 Obsidian | `src/lib/pipeline/daily.ts`、`src/lib/notify/discord.ts`、`scripts/obsidian_sync.py` |
| 选题策划 | 按账号档案从资讯池筛选题，带热度与相关性评分；可排进周日历 | `src/lib/pipeline/topics.ts` |
| 文案生成 | 一个选题按所选账号和形式一次出多个版本，套档案语气和知识库 | `src/lib/pipeline/copywriting.ts`、`src/lib/content/formats.ts` |
| X 短推 | 从选题生成，或把一段素材「润色」「翻译」成一条短推；不超过 250 字、无 emoji、不以问号结尾、不加互动引导，可选模型、可重出。规则沿用 [tweet-buffer-workflow](https://github.com/Kimberlying/tweet-buffer-workflow) | `src/lib/content/x-post.ts`、`src/app/(app)/contents/rewrite-form.tsx` |
| 长文 | X 长文；公众号长文由同一篇 X 长文改写，并配 3–6 张横版贴图 | `src/lib/xhs/prompts.ts` |
| 小红书内容包 | brief → 8–12 张知识卡 → 标题、正文、标签、检查，结构沿用 [build-xhs-content-pack](https://github.com/Kimberlying/build-xhs-content-pack) | `src/lib/xhs/` |
| 知识库（简版） | 语气指南、禁用词、历史爆款等，生成时自动带上 | `src/app/(app)/knowledge` |
| 合规（一期） | 禁用词检查，命中则留在草稿并标出命中词 | `src/lib/content/compliance.ts` |
| 发布排期 | X 短推和推文串走 API 定时发；发布结果不确定时不自动重发，在「内容」页人工核对后登记；X 长文、公众号、小红书等生成发布包（zip），人工发后登记 | `src/lib/connectors/`、`src/app/api/contents/[id]/pack` |
| 数据复盘 | 每天 3 点拉 X 帖子数据，按 7 / 30 天汇总 | `src/lib/pipeline/publish.ts`、`src/app/(app)/analytics` |
| 多租户与计量 | Supabase RLS 按组织隔离；`usage_logs` 记录每次生成的模型、token、费用 | `supabase/migrations/`、`src/lib/llm/` |

内容状态：草稿 → 合规检查 → 待审批 → 已批准 → 已排期 → 已发布，任一审批环节可退回草稿。自用组织默认关闭审批（`orgs.settings.approval_required = false`），合规通过直接到已批准。

不在一期：视觉生成、视频剪辑、多级审批台、IG / FB / LinkedIn 的 API 接入、互动回复、订阅计费，以及资讯雷达里的对标账号视频转录。

## 发布包和出图

长文和小红书内容在「内容」页可以下载发布包。小红书包的目录和 `cards/cards.json` 与 build-xhs-content-pack 一致，用它的脚本出图：

```bash
git clone https://github.com/Kimberlying/build-xhs-content-pack
cd build-xhs-content-pack/skills/build-xhs-content-pack
python3 -m pip install -r scripts/requirements.txt
python3 scripts/render_cards.py <发布包>/cards/cards.json --output-dir <发布包>/images
```

公众号包里的 `cards.json` 是 1200×675 横版贴图，用同一个命令出图。工作台里出图放在二期（视觉生成）。

## 技术栈

- **Next.js 16**（App Router、Server Actions）：页面和接口一套代码
- **Supabase**：Postgres、邮箱登录、行级安全
- **Inngest**：定时抓资讯、批量生成、定时发布、拉数据，可重试、看日志
- **模型**：业务代码只用模型别名（`grok`、`gemini-flash`），每个环节用哪个别名在 `src/lib/llm/models.ts` 里配。默认按 key 直连 xAI 和 Gemini（`src/lib/llm/providers.ts`）；配了 `LLM_GATEWAY_URL` 就改走 LiteLLM 代理（`litellm/config.yaml`）
- 平台令牌 AES-256-GCM 加密存在 `account_secrets`，这张表不开放任何 RLS 策略，只有后台任务能读

流水线按固定顺序跑，大模型只负责每一步里的生成，不让 Agent 自由调度。

## 本地跑起来

1. 安装依赖：`npm install`
2. 复制环境变量：`cp .env.example .env.local`，按注释填好
3. 建 Supabase 项目，执行 `supabase/migrations/` 下的 SQL（Supabase CLI：`supabase link` 后 `supabase db push`；或直接粘到 SQL Editor）。Authentication → URL Configuration 里把 `{APP_URL}/auth/callback` 加进 Redirect URLs
4. 模型：填好 `XAI_API_KEY` 和 `GEMINI_API_KEY` 就能用，可以跑 `npm run check:models` 用真 key 核对一遍（会花几分钱）。想走 LiteLLM 时见 `litellm/config.yaml` 顶部的命令
5. 启动 Inngest 本地开发服务：`npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
6. 启动应用：`npm run dev`，打开 http://localhost:3000 用邮箱登录。首次登录自动创建你的自用组织和工作区

然后：在「账号与档案」连接 X 账号（X 开发者后台的回调地址填 `{APP_URL}/api/connect/x/callback`，权限选 Read and write），填好账号档案；资讯雷达第二天早上开始自动跑，也可以在「选题」里手动出一批。

## 常用命令

```bash
npm run dev        # 开发
npm test           # 单元测试
npm run typecheck  # 类型检查
npm run lint
npm run build
```

## 加一个账号、加一个平台

- 加一个 X 小号：在「账号与档案」再连接一个 X 账号并填一份档案，不改代码
- 加一个平台：在 `src/lib/connectors/` 实现 `PlatformConnector`（`publish` 和 `fetchMetrics`），在 `index.ts` 注册，主流程不动

## 上线

部署到 Vercel + Supabase + Inngest Cloud 的步骤见 [docs/deploy.md](docs/deploy.md)。

已核对（2026-10）：xAI 文档的 `x_search` 示例用的就是 `grok-4.7`，走 Responses 接口；X API 已改为按量付费，发帖 0.015 美元一条、带链接 0.20 美元。拿到 key 后用 `npm run check:models` 实测一遍。
