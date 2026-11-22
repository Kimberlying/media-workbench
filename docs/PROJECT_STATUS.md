# 项目进度（截至 2026-11-22）

这份文档记录「全平台媒体工作台」到目前为止的目标、决定、已完成的工作、还没合并的改动，以及上线还差什么。以后每做完一块就更新这里。

## 一、目标

- kim 自用的全自动自媒体工作台：资讯进来，内容出去，数据回流。AI 负责效率，人负责品质。
- 全部中文产出（技术博主线的 Substack、LinkedIn 用英文）。
- 只放 kim 自己的内容，不混入客户（H Properties）的内容。
- 以[项目设计文档](https://claude.ai/code/artifact/78f5629d-d472-4fad-99a7-3faafcbd03d9)为准。
- 同一套代码分两种工作区模板：「技术创作者」和「营销」。以后若给其他开发者用，再单独包装成产品。

## 二、平台和发布方式

| 平台 | 内容 | 怎么发 |
| --- | --- | --- |
| X | 中文短推、推文串、长文 | 短推和推文串走 X API 或 Buffer；X 长文没有发布接口，出发布包人工发 |
| 小红书 | 内容包（8–12 张知识卡 + 标题、正文、话题） | 没有个人发布接口，出发布包；PR #12 起可推到 Telegram 在手机上发 |
| 微信公众号 | 由 X 长文改写的长文 + 3–6 张贴图 | 发布包，人工发 |
| LinkedIn | 英文帖 | 经 Buffer（不走官方 API） |
| Instagram | 图文 | 经 Buffer，至少一张图 |
| Substack | 英文长文 | 出复制即发稿，人工发 |
| 知乎、Threads | 回答、短帖 | 生成后人工发 |

## 三、关键决定（按时间）

- 2026-10-13：资讯雷达用 xAI Grok API 搜 X 热点（不用 @grok bot），去掉 Gemini 全网动态；kim Mac 上「X 运维」的 `fetch_ai_radar.py` 由工作台接管（固定信源、去重、每日 3 条短推草稿、推 Discord），Mac 只留 `scripts/obsidian_sync.py` 备份到 Obsidian。旧 Mac cron 等新流程跑稳后再停。
- 2026-10-13：加入微信公众号长文。
- 2026-10-16：去掉 LiteLLM，线上只用 Vercel + Supabase + Inngest；LinkedIn 和 Instagram 经 Buffer 发布。
- 2026-10-18：界面选方案 C（多彩卡片）。
- 2026-10-21：并入 signal-desk 的信源（不并应用），雷达信源 8 → 11。
- 2026-10-23：以 snapvee.com 为对标，做「素材（链接转写）」分线。
- 2026-10-28：技术创作者线最优先（为 building in public 和面试）：Telegram 发文字或语音 → X 中文短推、Substack 英文长文、LinkedIn 英文帖 → TG 审核 → Buffer 发。文案只用 Gemini，不办 xAI；配图可选 Gemini（默认）/ ChatGPT / 不出图。
- 2026-11-22：小红书发布包推到 Telegram（不用 Discord）；支持同平台多账号、在「模型」页随时换模型。

## 四、已合并进 main 的 PR

| PR | 内容 |
| --- | --- |
| #1 | 一期骨架：多租户数据模型、内容流水线、工作台页面 |
| #2 | X 长文、公众号长文、小红书内容包 |
| #3 | 资讯雷达接管 Mac 上的 X 资讯脚本：固定信源、今日 3 条、Discord 与 Obsidian |
| #4 | 上线准备：模型直连 xAI 和 Gemini，`.env.example`，[docs/deploy.md](deploy.md) |
| #5 | 小红书卡片和公众号贴图在工作台里直接出图（四套风格、六种版式） |
| #6 | Telegram 线 + 经 Buffer 发布（存草稿 / 进入队列 / 队列置顶 / 现在发送），[docs/quickstart-telegram.md](quickstart-telegram.md) |
| #7 | 界面改版：方案 C 多彩卡片 |
| #8 | 资讯雷达加 X Builders、Builder 播客、官方博客三个信源 |
| #9 | 素材（链接转写，Supadata）、知乎和 Threads 格式、Next.js 16.4.2 |

## 五、还没合并的 PR

建议合并顺序：**#11 → #13**，然后 #12，最后 #10。每次合并后在 Supabase 跑一遍新增的迁移（`supabase db push`）。

| PR | 状态 | 内容 | 合并注意 |
| --- | --- | --- | --- |
| [#11](https://github.com/Kimberlying/media-workbench/pull/11) | 待审（非草稿） | 文案只用 Gemini；配图选 Gemini / ChatGPT / 不出图；TG 里回复图片即换图；模型名在账号页改 | 新迁移 `20261028010000_media_bucket.sql`；ChatGPT 出图另需 `OPENAI_API_KEY` |
| [#13](https://github.com/Kimberlying/media-workbench/pull/13) | 草稿 | 「模型」页贴 Gemini / Claude / GPT / Grok / OpenRouter key（加密存，不用重部署），写稿和整理选题分开选模型；同平台多账号，X 多号可从 Buffer 一键导入，TG 用 @账号名 指定 | 叠在 #11 之上，**必须先合 #11**；新迁移 `20261122000000_multi_account_models.sql` |
| [#12](https://github.com/Kimberlying/media-workbench/pull/12) | 草稿 | 批准的小红书包推到 Telegram：卡片成相册，标题、正文、话题点一下复制，「已手动发布」按钮 | 无迁移；复用现有 TG 机器人 |
| [#10](https://github.com/Kimberlying/media-workbench/pull/10) | 草稿 | 素材页上传本地音视频转写（Supabase Storage 私有桶，免费档 50MB 上限） | 分支早于 #6，合并前要先同步 main；新迁移 `20261026000000_source_uploads.sql` |

以上改动都还没用真 key 实测过。

## 六、上线还差什么

上线步骤见 [docs/deploy.md](deploy.md)，最快跑通 Telegram 线见 [docs/quickstart-telegram.md](quickstart-telegram.md)。

**必须有：**
- Supabase 项目（URL、anon key、service role key），跑完 `supabase/migrations/`
- Vercel 部署
- Inngest Cloud（event key、signing key）
- Gemini API key（付费档）
- Buffer 个人 API key，并在「账号与档案」里选好频道
- Telegram 机器人 token + chat id + webhook secret，并设好 webhook（如果 Mac 旧脚本占用同一个机器人，另建一个）
- `TOKEN_ENCRYPTION_KEY`

**可选：**
- Discord webhook（资讯日报推送）
- OpenAI API key（ChatGPT 出图；ChatGPT 会员不能给服务器调用）
- Supadata API key（素材转写）
- xAI API key（雷达搜 X；X API 按量付费，无免费档）
- Anthropic / OpenRouter key（#13 合并后可在「模型」页填）

**上线后要核对：** Buffer 队列满时的报错原话、Instagram 额外参数、Gemini JSON 输出。

## 七、待办

- 用真 key 把 Telegram 线完整跑一遍。
- Next.js 有已知漏洞，单独升级一次。
- 新流程稳定后停掉 Mac 上的旧 cron。
- Video Scribe 项目：等 kim 给链接。
- 候选功能：评论分析、按对标账号自动抓新视频、AI 生图封面。

## 八、相关链接

- 设计文档：https://claude.ai/code/artifact/78f5629d-d472-4fad-99a7-3faafcbd03d9
- 可点击 Demo（示例数据）：https://claude.ai/artifact/SfZUZWTAS2ug2LyxrNixZR
- 界面三套样张（选了 C）：https://claude.ai/artifact/WcKiF1DbBJgCmvp7noY5NS
- 文章《为什么要做个人工作台》配图版：https://claude.ai/artifact/Y1m3bRB3HJEDYaqxibvmNw
- 文章三平台成稿（公众号、X 长文 + 引流短推、LinkedIn 英文）：https://claude.ai/artifact/3zv7vcAYf5z23qtK3JoS6Z
- 并入的 kim 已有仓库：[build-xhs-content-pack](https://github.com/Kimberlying/build-xhs-content-pack)、[tweet-buffer-workflow](https://github.com/Kimberlying/tweet-buffer-workflow)、[youtube-article](https://github.com/Kimberlying/youtube-article)、signal-desk（只并信源）
