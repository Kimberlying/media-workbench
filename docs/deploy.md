# 上线步骤

线上由四样东西组成，都有免费档，自用的量用不满：

| 服务 | 做什么 |
| --- | --- |
| Vercel | 跑 Next.js 应用（页面、接口、Inngest 入口） |
| Supabase | 数据库、邮箱登录 |
| Inngest Cloud | 定时任务：每天 7 点资讯雷达、3 点拉数据、定时发布 |
| xAI + Gemini API | 生成内容；不再需要单独托管 LiteLLM，配了 key 就直连 |
| Supadata | 「素材」页贴视频、播客链接转文字稿（可选，不配就只有这个页面用不了） |

带「你」的步骤要用你自己的账号操作，其余照做即可。

## 1. Supabase（你）

1. 在 supabase.com 新建项目，区域选离你近的（如 Singapore / Tokyo），记下数据库密码。
2. 执行建表 SQL，二选一：
   - 本机装了 Supabase CLI：`supabase link --project-ref <项目 ref>`，然后 `supabase db push`
   - 或者在 SQL Editor 里按文件名顺序粘贴 `supabase/migrations/` 下的全部文件并运行
3. Project Settings → API，记下 `Project URL`、`anon public` key、`service_role` key。
4. Authentication → URL Configuration：Site URL 填线上域名；Redirect URLs 加 `https://<线上域名>/auth/callback` 和 `http://localhost:3000/auth/callback`。

## 2. 模型 key（你）

- xAI：console.x.ai → API Keys 新建，充值少量额度。资讯雷达搜 X 按抓到的帖子计费，每千条 5 美元，另加 token 费（grok-4.7 输入 2 / 输出 6 美元每百万 token）。
- Gemini：aistudio.google.com → Get API key，绑定结算账号走付费档（免费档会拿数据训练，且限速）。

- Supadata（「素材」页转写用）：dash.supadata.ai 注册，引导流程里会自动生成 API key，填进 `SUPADATA_API_KEY`。免费档每月 100 积分：有字幕的视频 1 积分一条，没字幕用 AI 转写每分钟 2 积分（一小时的播客 120 积分），元数据另 1 积分；常用的话升 Basic（每月 300 积分）。youtube-article 插件用的是同一家，可以共用一个 key。

拿到 key 后在本地先核对一遍：把 key 填进 `.env.local`，运行 `npm run check:models`。它会真调一次 Grok、Gemini 的 JSON 模式和 Grok 的 `x_search`，花几分钱。

## 3. Vercel（你）

1. vercel.com 用 GitHub 登录，Add New → Project，导入 `Kimberlying/media-workbench`，框架自动识别为 Next.js，直接 Deploy。第一次部署会因为缺环境变量在用到时报错，正常。
2. Settings → Environment Variables，按 `.env.example` 填（Production 环境）。`APP_URL` 填 Vercel 给的域名，`TOKEN_ENCRYPTION_KEY` 和 `DIGEST_TOKEN` 用文件里的命令生成，保存在你的密码管理器里。
3. Deployments → 最新一次 → Redeploy，让环境变量生效。

注意：Vercel 免费档（Hobby）限个人非商业使用；如果账号接了商单，换 Pro。

## 4. Inngest（你）

1. Vercel 项目 → Integrations → 搜 Inngest → Add，按提示登录 Inngest 并关联这个项目。它会自动写入 `INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY`，并在每次部署后同步函数。
2. 在 Inngest 控制台的 Apps 里能看到 `media-workbench` 和 6 个函数，`radar-daily` 的下次运行时间是北京时间早上 7 点。
3. 想马上看效果：在 `radar-daily` 页面点 Invoke 手动跑一次。

## 5. Discord 和 X（你）

- Discord：频道设置 → 整合 → Webhook → 新建并复制 URL，填进 `DISCORD_WEBHOOK_URL`。
- X：developer.x.com 建 App（现在是按量付费，没有免费档，先在 Developer Console 充值并设消费上限）。User authentication settings 里类型选 Web App，权限 Read and write，回调地址 `https://<线上域名>/api/connect/x/callback`，拿到 Client ID / Secret 填进环境变量后 Redeploy。
  - 费用参考（2026-09 的价目）：发一条帖 0.015 美元，带链接的帖 0.20 美元；读自己的帖子数据每条 0.001 美元。每天发几条，一个月几美元。

## 6. 第一次登录

1. 打开线上域名，用邮箱登录，首次登录会自动建好你的组织和工作区。
2. 「账号与档案」连接 X 账号，填账号档案（定位、语气、关注话题）。资讯雷达按档案里的话题搜 X，没有档案只跑 11 个固定信源。
3. 第二天早上 7 点后看「选题」和 Discord；或者在 Inngest 手动 Invoke 一次 `radar-daily`。

## 7. Mac 上的 Obsidian 同步，并停掉旧脚本（你）

新流程跑通一两天、Discord 和日报都正常后：

1. 把 `scripts/obsidian_sync.py` 放到 Mac 上（例如「X 运维」文件夹），`crontab -e` 加一行：

   ```
   30 7 * * *  WORKBENCH_URL=https://<线上域名> DIGEST_TOKEN=<口令> /usr/bin/python3 "/Users/<你>/Desktop/DE for google/X 运维/obsidian_sync.py"
   ```

   先手动跑一次 `python3 obsidian_sync.py`，确认 Obsidian 的「AI 资讯」下出现当天的三个文件。
2. 同一个 crontab 里删掉 `fetch_ai_radar.py` 那一行。旧脚本文件先留着，不用删。
