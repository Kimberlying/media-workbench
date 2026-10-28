import { getFormat } from "@/lib/content/formats";
import type { Account, AccountProfile, Org, Topic } from "@/lib/db/types";
import { getGateway } from "@/lib/llm";
import { generateContents } from "@/lib/pipeline/copywriting";
import { dueContents, publishContent, syncMetrics } from "@/lib/pipeline/publish";
import { collectInterests, fetchFeeds, fetchNews, fromGrok, RADAR_SOURCES, saveNews } from "@/lib/pipeline/radar";
import { loadDigest, writeDailyPosts } from "@/lib/pipeline/daily";
import { planTopicsForAccount } from "@/lib/pipeline/topics";
import { planNote, sendReviews, transcribeNote } from "@/lib/pipeline/telegram";
import { requireEnv } from "@/lib/env";
import { TelegramBot } from "@/lib/telegram/bot";
import {
  checkTranscript,
  digestSource,
  loadSource,
  markSourceFailed,
  saveMetadata,
  startTranscript,
  supadataFromEnv,
  type TranscriptStep,
} from "@/lib/pipeline/sources";
import { discordMessages, sendDiscord } from "@/lib/notify/discord";
import { digestDay } from "@/lib/radar/daily";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENTS, inngest } from "./client";

// 流水线按固定顺序跑，大模型只负责每一步里的生成；每一步可重试、可在 Inngest 里看日志。
// 定时默认按北京时间，改时区只改这里的 TZ。

export const radarDaily = inngest.createFunction(
  { id: "radar-daily", triggers: [{ cron: "TZ=Asia/Shanghai 0 7 * * *" }] },
  async ({ step }) => {
    const db = createAdminClient();
    // 当天日期在第一步定下来，重试时不会跨日
    const day = await step.run("day", () => digestDay());

    // 固定信源不依赖账号档案，先入库；热度高的优先占位，Grok 搜到的同一件事会被去重挡掉
    const feedItems = await step.run("fetch-feeds", () => fetchFeeds());
    let saved = await step.run("save-feeds", () => saveNews(db, feedItems));

    const interests = await step.run("collect-interests", () => collectInterests(db));
    for (const source of interests.length > 0 ? RADAR_SOURCES : []) {
      const items = await step.run(`fetch-${source.source}`, () =>
        fetchNews(getGateway(), interests, source),
      );
      saved += await step.run(`save-${source.source}`, () => saveNews(db, fromGrok(source.source, items)));
    }

    // 今日 3 条短推草稿，再把热度前 5 和这 3 条推到 Discord
    const posts = await step.run("daily-posts", () => writeDailyPosts(db, getGateway(), day));
    const webhook = process.env.DISCORD_WEBHOOK_URL;
    if (webhook) {
      await step.run("push-discord", async () => {
        const { digest, posts } = await loadDigest(db, day);
        return sendDiscord(webhook, discordMessages(digest, posts));
      });
    }

    // 资讯入库后，给每个有档案的账号出候选选题
    const accountIds = await step.run("list-accounts", async () => {
      const { data, error } = await db.from("accounts").select("id").not("profile_id", "is", null);
      if (error) throw new Error(error.message);
      return (data ?? []).map((a) => a.id as string);
    });
    if (accountIds.length > 0) {
      await step.sendEvent(
        "request-topics",
        accountIds.map((accountId) => ({ name: EVENTS.topicsRequested, data: { accountId } })),
      );
    }
    return { day, saved, posts, accounts: accountIds.length };
  },
);

export const planTopics = inngest.createFunction(
  { id: "plan-topics", triggers: [{ event: EVENTS.topicsRequested }] },
  async ({ event, step }) => {
    const db = createAdminClient();
    const accountId = (event.data as { accountId: string }).accountId;
    const { account, profile } = await step.run("load-account", async () => {
      const { data, error } = await db
        .from("accounts")
        .select("*, profile:account_profiles(*)")
        .eq("id", accountId)
        .single();
      if (error) throw new Error(error.message);
      const { profile, ...account } = data as Account & { profile: AccountProfile | null };
      if (!profile) throw new Error("账号还没有档案");
      return { account: account as Account, profile };
    });
    const created = await step.run("plan", () =>
      planTopicsForAccount(db, getGateway(), account, profile),
    );
    return { created };
  },
);

export const generateContentsFn = inngest.createFunction(
  { id: "generate-contents", triggers: [{ event: EVENTS.contentsRequested }] },
  async ({ event, step }) => {
    const db = createAdminClient();
    const { topicId, targets: requested } = event.data as {
      topicId: string;
      targets: { accountId: string; format: string }[];
    };
    const accountIds = [...new Set(requested.map((t) => t.accountId))];

    const ctx = await step.run("load", async () => {
      const { data: topic, error } = await db.from("topics").select("*").eq("id", topicId).single();
      if (error) throw new Error(error.message);
      const { data: org, error: orgError } = await db
        .from("orgs")
        .select("*")
        .eq("id", topic.org_id)
        .single();
      if (orgError) throw new Error(orgError.message);
      const { data: accounts, error: accError } = await db
        .from("accounts")
        .select("*, profile:account_profiles(*)")
        .in("id", accountIds)
        .eq("org_id", topic.org_id);
      if (accError) throw new Error(accError.message);
      const byId = new Map((accounts ?? []).filter((a) => a.profile).map((a) => [a.id as string, a]));
      const targets = requested.flatMap(({ accountId, format }) => {
        const row = byId.get(accountId);
        if (!row) return [];
        const { profile, ...account } = row;
        return [{ account: account as Account, profile: profile as AccountProfile, formatId: format }];
      });
      return { topic: topic as Topic, org: org as Org, targets };
    });

    const ids = await step.run("generate", () =>
      generateContents(
        db,
        getGateway(),
        ctx.topic,
        ctx.targets.map(({ formatId, ...t }) => ({ ...t, format: getFormat(formatId) })),
        ctx.org.settings?.approval_required ?? false,
      ),
    );
    await step.run("mark-topic-used", async () => {
      await db.from("topics").update({ status: "used" }).eq("id", topicId);
    });
    return { contents: ids };
  },
);

// 素材：贴一个视频或播客链接 → 文字稿 → 整理。长视频 Supadata 异步转写，先等 10 秒查几次，再每 30 秒查一次，最多等 20 分钟左右
export const transcribeSource = inngest.createFunction(
  {
    id: "transcribe-source",
    triggers: [{ event: EVENTS.sourceRequested }],
    // 同一条素材同时只跑一个，重复点「重试」不会重复扣积分
    singleton: { key: "event.data.sourceId", mode: "skip" },
    onFailure: async ({ event, error }) => {
      const { sourceId } = event.data.event.data as { sourceId: string };
      await markSourceFailed(createAdminClient(), sourceId, error.message);
    },
  },
  async ({ event, step }) => {
    const db = createAdminClient();
    const { sourceId } = event.data as { sourceId: string };
    const source = await step.run("load", () => loadSource(db, sourceId));

    await step.run("metadata", () => saveMetadata(db, source, supadataFromEnv()));
    let result: TranscriptStep = await step.run("transcribe", () => startTranscript(db, source, supadataFromEnv()));
    if (result.kind === "job") {
      const jobId = result.jobId;
      for (let i = 0; i < 42 && result.kind !== "done" && result.kind !== "failed"; i++) {
        await step.sleep(`wait-${i}`, i < 6 ? "10s" : "30s");
        result = await step.run(`poll-${i}`, () => checkTranscript(db, sourceId, jobId, supadataFromEnv()));
      }
      if (result.kind !== "done" && result.kind !== "failed") {
        await step.run("timeout", () => markSourceFailed(db, sourceId, "转写超过 20 分钟还没好，稍后点「重试」"));
        return { status: "timeout" };
      }
    }
    if (result.kind === "failed") return { status: "failed" };

    const digest = await step.run("digest", () => digestSource(db, getGateway(), sourceId));
    return { status: "ready", ...digest };
  },
);

function telegramBot() {
  return new TelegramBot({ token: requireEnv("TELEGRAM_BOT_TOKEN"), chatId: requireEnv("TELEGRAM_CHAT_ID") });
}

// Telegram 笔记：（语音先转写）→ 整理观点 → 按技术博主模板写 X、Substack、LinkedIn → 逐条推回 TG 审核
export const telegramNote = inngest.createFunction(
  {
    id: "telegram-note",
    triggers: [{ event: EVENTS.telegramNote }],
    singleton: { key: "event.data.sourceId", mode: "skip" },
    onFailure: async ({ event, error }) => {
      const { sourceId, messageId } = event.data.event.data as { sourceId: string; messageId?: number };
      await markSourceFailed(createAdminClient(), sourceId, error.message);
      await telegramBot().send(`这条没处理成：${error.message.slice(0, 300)}\n可以到工作台「素材」里看，或者重发一次。`, undefined, messageId);
    },
  },
  async ({ event, step }) => {
    const db = createAdminClient();
    const { sourceId, voice } = event.data as {
      sourceId: string;
      messageId?: number;
      voice?: { fileId: string; mimeType: string };
    };
    if (voice) {
      await step.run("transcribe", () =>
        transcribeNote(db, telegramBot(), sourceId, voice, {
          apiKey: requireEnv("GEMINI_API_KEY"),
          model: process.env.GEMINI_MODEL,
        }),
      );
    }
    await step.run("digest", () => digestSource(db, getGateway(), sourceId));

    const plan = await step.run("plan", () => planNote(db, sourceId));
    if (!plan) {
      await step.run("no-accounts", () =>
        telegramBot().send("笔记整理好了，但还没有可写的账号：到工作台「账号与档案」点「一键建好技术博主模板」。"),
      );
      return { contents: 0 };
    }
    const ids = await step.run("generate", async () => {
      const { data: org, error } = await db.from("orgs").select("settings").eq("id", plan.topic.org_id).single();
      if (error) throw new Error(error.message);
      return generateContents(
        db,
        getGateway(),
        plan.topic,
        plan.targets.map(({ formatId, ...t }) => ({ ...t, format: getFormat(formatId) })),
        (org.settings as Org["settings"] | null)?.approval_required ?? false,
      );
    });
    await step.run("mark-topic-used", async () => {
      await db.from("topics").update({ status: "used" }).eq("id", plan.topic.id);
    });
    const sent = await step.run("review", () => sendReviews(db, telegramBot(), ids));
    return { contents: ids.length, sent };
  },
);

export const publishDue = inngest.createFunction(
  { id: "publish-due", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => {
    const db = createAdminClient();
    const due = await step.run("find-due", () => dueContents(db));
    const published: string[] = [];
    for (const content of due) {
      // 每条单独一步：一条失败只重试这一条
      published.push(await step.run(`publish-${content.id}`, () => publishContent(db, content)));
    }
    return { published: published.length };
  },
);

export const metricsDaily = inngest.createFunction(
  { id: "metrics-daily", triggers: [{ cron: "TZ=Asia/Shanghai 0 3 * * *" }] },
  async ({ step }) => {
    const db = createAdminClient();
    const written = await step.run("sync", () => syncMetrics(db));
    return { written };
  },
);

export const functions = [
  radarDaily,
  planTopics,
  generateContentsFn,
  transcribeSource,
  telegramNote,
  publishDue,
  metricsDaily,
];
