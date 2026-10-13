import { getFormat } from "@/lib/content/formats";
import type { Account, AccountProfile, Org, Topic } from "@/lib/db/types";
import { getGateway } from "@/lib/llm";
import { generateContents } from "@/lib/pipeline/copywriting";
import { dueContents, publishContent, syncMetrics } from "@/lib/pipeline/publish";
import { collectInterests, fetchFeeds, fetchNews, fromGrok, RADAR_SOURCES, saveNews } from "@/lib/pipeline/radar";
import { loadDigest, writeDailyPosts } from "@/lib/pipeline/daily";
import { planTopicsForAccount } from "@/lib/pipeline/topics";
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

export const functions = [radarDaily, planTopics, generateContentsFn, publishDue, metricsDaily];
