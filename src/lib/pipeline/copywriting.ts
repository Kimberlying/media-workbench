import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, AccountProfile, Platform, Topic } from "@/lib/db/types";
import { checkTabooWords, parseTabooList } from "@/lib/content/compliance";
import type { LlmGateway } from "@/lib/llm";
import type { Step } from "@/lib/llm/models";

// 文案生成：一个选题按目标账号一次出多平台版本，套账号档案的语气和知识库。
// 生成后立刻跑一期的合规检查（禁用词）：命中则停在草稿并带上命中词，未命中进入合规检查通过后的下一步。

const PLATFORM_FORMATS: Record<Platform, { format: string; step: Step; guide: string }> = {
  x: {
    format: "thread",
    step: "copy.x_thread",
    guide:
      "写一条 X 推文串，3–6 条，每条不超过 280 个字符（中文约 140 字）。" +
      "条与条之间用单独一行 --- 分隔。第一条要能单独成立、抓人。",
  },
  instagram: {
    format: "caption",
    step: "copy.post",
    guide: "写一段 Instagram 配文，150–300 字，结尾 5–10 个话题标签。",
  },
  facebook: {
    format: "post",
    step: "copy.post",
    guide: "写一条 Facebook 主页帖子，200–400 字，口语化，结尾一个互动问题。",
  },
  linkedin: {
    format: "post",
    step: "copy.post",
    guide: "写一条 LinkedIn 帖子，300–600 字，专业但不生硬，分段清楚，结尾 3 个话题标签。",
  },
  xiaohongshu: {
    format: "note",
    step: "copy.post",
    guide: "写一篇小红书笔记：一个不超过 20 字的标题，正文 300–600 字，适度使用 emoji，结尾 5–8 个话题。",
  },
};

export interface KnowledgeContext {
  toneGuides: string[];
  tabooWords: string[];
  viralExamples: string[];
}

export async function loadKnowledge(
  db: SupabaseClient,
  workspaceId: string,
): Promise<KnowledgeContext> {
  const { data, error } = await db
    .from("knowledge_items")
    .select("type, content")
    .eq("workspace_id", workspaceId)
    .in("type", ["tone_guide", "taboo_words", "viral_post"])
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    toneGuides: rows.filter((r) => r.type === "tone_guide").map((r) => r.content),
    tabooWords: rows.filter((r) => r.type === "taboo_words").flatMap((r) => parseTabooList(r.content)),
    viralExamples: rows.filter((r) => r.type === "viral_post").slice(0, 5).map((r) => r.content),
  };
}

export function buildCopyPrompt(
  topic: Pick<Topic, "title" | "angle">,
  account: Pick<Account, "platform" | "handle">,
  profile: AccountProfile,
  knowledge: KnowledgeContext,
) {
  const spec = PLATFORM_FORMATS[account.platform];
  const examples = knowledge.viralExamples.length
    ? `\n\n过往表现好的内容（只学结构和语感，不要照抄）：\n${knowledge.viralExamples
        .map((e, i) => `${i + 1}. ${e}`)
        .join("\n")}`
    : "";
  return [
    {
      role: "system" as const,
      content:
        `你在为账号 @${account.handle} 写内容。只输出正文，不要解释。\n` +
        `账号定位：${profile.positioning}\n目标受众：${profile.audience}\n语气：${profile.tone}\n` +
        `语言：${profile.language}\n` +
        (knowledge.toneGuides.length ? `语气指南：\n${knowledge.toneGuides.join("\n")}\n` : "") +
        `绝对不能出现的词：${[...profile.taboo, ...knowledge.tabooWords].join("、") || "无"}`,
    },
    {
      role: "user" as const,
      content: `选题：${topic.title}\n切入角度：${topic.angle}\n\n${spec.guide}${examples}`,
    },
  ];
}

export async function generateContents(
  db: SupabaseClient,
  llm: LlmGateway,
  topic: Topic,
  targets: { account: Account; profile: AccountProfile }[],
  approvalRequired: boolean,
): Promise<string[]> {
  const ids: string[] = [];
  for (const { account, profile } of targets) {
    const spec = PLATFORM_FORMATS[account.platform];
    const knowledge = await loadKnowledge(db, account.workspace_id);
    const body = await llm.generate({
      orgId: account.org_id,
      step: spec.step,
      refId: topic.id,
      messages: buildCopyPrompt(topic, account, profile, knowledge),
    });

    const compliance = checkTabooWords(body, [...profile.taboo, ...knowledge.tabooWords]);
    const status = !compliance.ok ? "draft" : approvalRequired ? "pending_approval" : "approved";

    const { data, error } = await db
      .from("contents")
      .insert({
        org_id: account.org_id,
        topic_id: topic.id,
        account_id: account.id,
        variant: `${account.platform}:${profile.language}:${spec.format}`,
        body,
        status,
        compliance_hits: compliance.hits,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    ids.push(data.id);
  }
  return ids;
}

export { PLATFORM_FORMATS };
