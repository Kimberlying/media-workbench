# 最快跑通：Telegram → X、Substack、LinkedIn

这条线：给 Telegram 机器人发一段文字或语音 → 工作台转写、整理观点 → 写成 **X 中文短推**、**Substack 英文长文**、**LinkedIn 英文帖** → 三条逐条发回 TG 给你审：

- X 和 LinkedIn：消息下面有「存草稿 / 进入队列 / 队列置顶 / 现在发送」，点了就交给 Buffer（现在发送要再点一次确认）。
- 要改：直接回复那条消息，发改好的全文，会重新发一条给你审。
- Substack：发的是复制包（第一行是标题），复制贴进 Substack 编辑器发布，再点「已手动发布」。Substack 没有发布接口，只能这样。

资讯雷达、小红书、公众号、Discord、X 开发者 App 都不用配。

## 要准备的

| 东西 | 去哪拿 | 环境变量 |
| --- | --- | --- |
| Supabase 项目 | supabase.com 新建项目，按文件名顺序跑 `supabase/migrations/` 里全部 SQL | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` |
| Gemini key（付费档） | aistudio.google.com → Get API key，绑结算账号。转写语音、整理笔记、写 Substack 和 LinkedIn 都用它 | `GEMINI_API_KEY` |
| xAI key | console.x.ai → API Keys，充 5–10 美元。写 X 中文短推用 Grok | `XAI_API_KEY` |
| Buffer API key | Buffer 里连好 X 和 LinkedIn 频道，Settings → API 生成个人 key | `BUFFER_API_KEY` |
| Telegram 机器人 | Telegram 找 @BotFather 发 `/newbot`，拿到 token；再给 @userinfobot 发条消息拿到你的 chat id | `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID` |
| Vercel + Inngest | vercel.com 用 GitHub 登录导入 `Kimberlying/media-workbench`；项目 Integrations 里加 Inngest，它自动填两个 key | `INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY` |

自己生成、不用注册的：`TELEGRAM_WEBHOOK_SECRET`、`TOKEN_ENCRYPTION_KEY`、`DIGEST_TOKEN`（终端跑 `openssl rand -hex 32`，各生成一个）。`APP_URL` 填 Vercel 给的域名。

不想办 xAI：在 Vercel 加一行 `LLM_MODEL_OVERRIDES={"copy.x_post":"gemini-flash"}`，X 短推也改用 Gemini 写。

## 步骤

1. **Supabase**：建项目、跑 SQL。Authentication → URL Configuration 里 Site URL 填 Vercel 域名，Redirect URLs 加 `https://<域名>/auth/callback`。
2. **Vercel**：导入仓库，Settings → Environment Variables 按上表填好，Deployments 里 Redeploy。
3. **Inngest**：Vercel 项目 → Integrations → Inngest → Add。Inngest 控制台里能看到 `telegram-note` 函数就对了。
4. **设 webhook**（终端跑一次）：

   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d url=https://<域名>/api/telegram/webhook \
     -d secret_token=<TELEGRAM_WEBHOOK_SECRET> \
     -d 'allowed_updates=["message","callback_query"]'
   ```

   一个机器人只能有一个 webhook；Mac 上旧脚本如果在用同一个机器人，就给工作台另建一个。
5. **登录工作台**：打开域名用邮箱登录。「账号与档案」最上面「一键建好技术博主模板」，填 X 账号名、Substack 名称、LinkedIn 名字，点「建好三个账号」。然后给 X、LinkedIn 两个账号的「Buffer 频道」各选对应频道。
6. **试一条**：给机器人发一段话，比如「今天把 Telegram 接进了我的内容工作台，语音进来自动出三个平台的稿子」。机器人回「收到」，一两分钟后三条稿子发回来。对 X 那条点「存草稿」，去 Buffer 看到草稿就算跑通。

## 出问题时

- 机器人没回「收到」：webhook 没设对。浏览器打开 `https://api.telegram.org/bot<token>/getWebhookInfo` 看 `last_error_message`。
- 回了「收到」但没出稿：Inngest 控制台打开 `telegram-note` 最近一次运行看是哪一步报错；机器人也会回一句失败原因。
- 回「还没有可写的账号」：第 5 步的模板没建，或账号没有档案。
