import type { SupabaseClient } from "@supabase/supabase-js";
import { checkTabooWords, parseTabooList } from "@/lib/content/compliance";
import { variantOf, type FormatSpec } from "@/lib/content/formats";
import { checkXPost, finishXPost } from "@/lib/content/x-post";
import type { Account, AccountProfile, Topic } from "@/lib/db/types";
import type { ChatMessage, LlmGateway } from "@/lib/llm";
import { modelFor } from "@/lib/llm/models";
import { checkBodyRepeatsCards, checkCards, checkRiskyClaims } from "@/lib/xhs/checks";
import { buildWechatGraphicsPrompt, buildXhsPackPrompt, wechatAdaptation } from "@/lib/xhs/prompts";
import {
  WECHAT_SIZE,
  WechatGraphicsDraft,
  XHS_SIZE,
  XhsPackDraft,
  type Card,
  type CardsFile,
  type ContentPack,
} from "@/lib/xhs/schema";

// 文案生成：一个选题按目标账号和内容形式一次出多个版本，套账号档案的语气和知识库。
// 长文先写；公众号长文由 X 长文改写，小红书内容包以长文为素材拆卡（结构沿用 build-xhs-content-pack）。
// 生成后立刻跑一期的合规检查（禁用词）：命中则停在草稿并带上命中词，未命中进入合规检查通过后的下一步。

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
  account: Pick<Account, "handle">,
  profile: AccountProfile,
  knowledge: KnowledgeContext,
  spec: FormatSpec,
  extra = "",
): ChatMessage[] {
  const examples = knowledge.viralExamples.length
    ? `\n\n过往表现好的内容（只学结构和语感，不要照抄）：\n${knowledge.viralExamples
        .map((e, i) => `${i + 1}. ${e}`)
        .join("\n")}`
    : "";
  const output =
    spec.kind === "longform" ? "第一行用「# 标题」写标题，正文用 Markdown。" : "只输出正文，不要解释。";
  return [
    {
      role: "system",
      content:
        `你在为账号 @${account.handle} 写内容。${output}\n` +
        `账号定位：${profile.positioning}\n目标受众：${profile.audience}\n语气：${profile.tone}\n` +
        `语言：${profile.language}\n` +
        (knowledge.toneGuides.length ? `语气指南：\n${knowledge.toneGuides.join("\n")}\n` : "") +
        `绝对不能出现的词：${[...profile.taboo, ...knowledge.tabooWords].join("、") || "无"}`,
    },
    {
      role: "user",
      content: `选题：${topic.title}\n切入角度：${topic.angle}\n\n${spec.guide}${examples}${extra}`,
    },
  ];
}

export interface Target {
  account: Account;
  profile: AccountProfile;
  format: FormatSpec;
}

const ORDER: Record<string, number> = { "x.article": 0, "wechat.article": 1, "xiaohongshu.pack": 2 };

/** 长文先写：公众号长文由 X 长文改写，小红书内容包以长文为素材拆卡 */
export function orderTargets(targets: Target[]): Target[] {
  return [...targets].sort((a, b) => (ORDER[a.format.id] ?? 9) - (ORDER[b.format.id] ?? 9));
}

export function titleOf(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1].trim() ?? "";
}

function cardText(cards: Card[]): string[] {
  return cards.flatMap((c) => [
    c.title,
    c.subtitle,
    c.eyebrow,
    ...(c.bullets ?? []),
    ...(c.left?.items ?? []),
    ...(c.right?.items ?? []),
    c.quote ?? "",
    c.note ?? "",
    c.prompt ?? "",
  ]);
}

interface Generated {
  body: string;
  pack: ContentPack | null;
  /** 参与禁用词检查的全部文字 */
  text: string[];
}

async function generateOne(
  llm: LlmGateway,
  topic: Topic,
  target: Target,
  knowledge: KnowledgeContext,
  longformSource: { id: string; body: string } | undefined,
): Promise<Generated> {
  const { account, profile, format } = target;
  const taboo = [...profile.taboo, ...knowledge.tabooWords];
  const base = { orgId: account.org_id, refId: topic.id };

  if (format.kind === "text") {
    const raw = await llm.generate({
      ...base,
      step: format.step,
      messages: buildCopyPrompt(topic, account, profile, knowledge, format),
    });
    if (format.id !== "x.post") return { body: raw, pack: null, text: [raw] };
    const body = finishXPost(raw);
    return {
      body,
      pack: { kind: "post", model: modelFor(format.step), mode: "topic", checks: checkXPost(body) },
      text: [body],
    };
  }

  if (format.kind === "longform") {
    const adapt =
      format.id === "wechat.article" && longformSource?.id === "x.article"
        ? wechatAdaptation(longformSource.body)
        : "";
    const body = await llm.generate({
      ...base,
      step: format.step,
      messages: buildCopyPrompt(topic, account, profile, knowledge, format, adapt),
    });

    let graphics: CardsFile | null = null;
    const checks = checkRiskyClaims([body]);
    if (format.platform === "wechat") {
      const draft = await llm.generate({
        ...base,
        step: "copy.xhs_pack",
        json: WechatGraphicsDraft,
        messages: buildWechatGraphicsPrompt(body),
      });
      graphics = {
        meta: { title: titleOf(body) || topic.title, ...WECHAT_SIZE, theme: "editorial", footer: `@${account.handle}` },
        cards: draft.cards,
      };
      checks.push(...checkCards(graphics, { landscape: true }));
    }
    return {
      body,
      pack: { kind: "longform", title: titleOf(body) || topic.title, graphics, checks },
      text: [body, ...cardText(graphics?.cards ?? [])],
    };
  }

  const draft = await llm.generate({
    ...base,
    step: format.step,
    json: XhsPackDraft,
    messages: buildXhsPackPrompt({
      handle: account.handle,
      positioning: profile.positioning,
      audience: profile.audience,
      tone: profile.tone,
      taboo,
      topicTitle: topic.title,
      angle: topic.angle,
      source: longformSource?.body,
    }),
  });
  const cards: CardsFile = {
    meta: { title: draft.brief.topic || topic.title, ...XHS_SIZE, theme: draft.theme, footer: `@${account.handle}` },
    cards: draft.cards,
  };
  const body = `${draft.body}\n\n${draft.tags.map((t) => `#${t}`).join(" ")}`.trim();
  return {
    body,
    pack: {
      kind: "xhs",
      brief: draft.brief,
      cards,
      titles: draft.titles,
      tags: draft.tags,
      source_notes: draft.source_notes,
      checks: [
        ...checkCards(cards),
        ...checkRiskyClaims([body, ...cardText(draft.cards)]),
        ...checkBodyRepeatsCards(draft.body, draft.cards),
      ],
    },
    text: [body, ...draft.titles, ...cardText(draft.cards)],
  };
}

export async function generateContents(
  db: SupabaseClient,
  llm: LlmGateway,
  topic: Topic,
  targets: Target[],
  approvalRequired: boolean,
): Promise<string[]> {
  const ids: string[] = [];
  let longformSource: { id: string; body: string } | undefined;

  for (const target of orderTargets(targets)) {
    const { account, profile, format } = target;
    const knowledge = await loadKnowledge(db, account.workspace_id);
    const generated = await generateOne(llm, topic, target, knowledge, longformSource);
    if (format.kind === "longform" && !longformSource) {
      longformSource = { id: format.id, body: generated.body };
    }

    const compliance = checkTabooWords(generated.text.join("\n"), [...profile.taboo, ...knowledge.tabooWords]);
    const status = !compliance.ok ? "draft" : approvalRequired ? "pending_approval" : "approved";

    const { data, error } = await db
      .from("contents")
      .insert({
        org_id: account.org_id,
        topic_id: topic.id,
        account_id: account.id,
        variant: variantOf(format, profile.language),
        body: generated.body,
        pack: generated.pack,
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
