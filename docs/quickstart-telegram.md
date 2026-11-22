# 最快跑通：Telegram → X、Substack、LinkedIn

这条线：给 Telegram 机器人发一段文字或语音 → 工作台转写、整理观点 → 写成 **X 中文短推**、**Substack 英文长文**、**LinkedIn 英文帖**，再用 Gemini 出一张共用的配图 → 三条逐条发回 TG 给你审（图先发）：

- X 和 LinkedIn：消息下面有「存草稿 / 进入队列 / 队列置顶 / 现在发送」，点了就交给 Buffer（现在发送要再点一次确认）。
- 要改：直接回复那条消息，发改好的全文，会重新发一条给你审。
- Substack：发的是复制包（第一行是标题，下面附封面图链接），复制贴进 Substack 编辑器发布，再点「已手动发布」。Substack 没有发布接口，只能这样。
- 配图：默认用 Gemini 出，X 和 LinkedIn 交给 Buffer 时自动带上。图出不来不影响发稿，机器人会说一声。
  - 在工作台「模型」页可以改成 **ChatGPT** 出图或 **不出图**。ChatGPT 会员不能给服务器调用，选 ChatGPT 要另办 OpenAI API key（platform.openai.com，单独充值），贴到「模型」页（或填进 `OPENAI_API_KEY`）。
  - 不办 OpenAI key 也能用 ChatGPT 的图：在 ChatGPT 里做好图，在 TG 里**回复那条稿子发这张图**（当图片或当文件发都行），同一篇的几条稿子都会换成这张。

资讯雷达、小红书、公众号、Discord、X 开发者 App 都不用配。

## 换模型

都在工作台左边的「模型」页，不改代码、不重新部署：

1. **贴 key**：用到哪家贴哪家（Gemini、Claude、GPT、Grok、OpenRouter），加密存库，页面只露最后 4 位。也可以照旧放 Vercel 环境变量。
2. **选模型**：分「写稿」和「整理和选题」两个用途。点输入框会列出有 key 的厂商现在能用的模型，也可以直接打，例如 `claude-sonnet-5-5`、`gemini/gemini-3.8-flash`、`openai/<模型名>`。空着用默认（`gemini-3.8-flash`）。
3. **试一下**：点「试一下写稿模型」真调一次，key 或模型名不对会直接说。

某个账号想单独用别的模型（比如 LinkedIn 英文号用 Claude，X 中文号用 Gemini），到「账号与档案」里那个号的「写稿模型」填上。语音转写固定用 Gemini；出图模型也在「模型」页改。

## 多个账号

同一个平台可以有好几个号（比如两个 X 号）：

- 在 Buffer 里先连好这些号，工作台「账号与档案」会出现「从 Buffer 导入账号」，点一次全部加进来并绑好频道；或者在页面最下面「添加账号」手动加，再选 Buffer 频道。
- 新号会复制同平台第一个号的档案（定位、语气、禁用词），再按这个号改。
- 给机器人发笔记默认每个号都写一份；某个号不想要，取消它的「Telegram 发来的笔记也给这个号写一份」。
- 笔记开头写 `@账号名`（可以写几个），这条就只给这几个号写。

## 要准备的

| 东西 | 去哪拿 | 环境变量 |
| --- | --- | --- |
| Supabase 项目 | supabase.com 新建项目，按文件名顺序跑 `supabase/migrations/` 里全部 SQL | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` |
| Gemini key（付费档） | aistudio.google.com → Get API key，绑结算账号。转写语音、整理笔记、写 X、Substack、LinkedIn、出配图都用它，只要这一个模型 key | `GEMINI_API_KEY` |
| Buffer API key | Buffer 里连好 X 和 LinkedIn 频道，Settings → API 生成个人 key | `BUFFER_API_KEY` |
| Telegram 机器人 | Telegram 找 @BotFather 发 `/newbot`，拿到 token；再给 @userinfobot 发条消息拿到你的 chat id | `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID` |
| Vercel + Inngest | vercel.com 用 GitHub 登录导入 `Kimberlying/media-workbench`；项目 Integrations 里加 Inngest，它自动填两个 key | `INNGEST_EVENT_KEY`、`INNGEST_SIGNING_KEY` |

自己生成、不用注册的：`TELEGRAM_WEBHOOK_SECRET`、`TOKEN_ENCRYPTION_KEY`、`DIGEST_TOKEN`（终端跑 `openssl rand -hex 32`，各生成一个）。`APP_URL` 填 Vercel 给的域名。

## 步骤

1. **Supabase**：建项目、跑 SQL（里面会建一个公开的 `media` 存储桶放配图）。Authentication → URL Configuration 里 Site URL 填 Vercel 域名，Redirect URLs 加 `https://<域名>/auth/callback`。
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
