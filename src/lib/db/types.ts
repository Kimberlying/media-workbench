// 与 supabase/migrations 对应的领域类型。表结构变更时同步修改。

import type { SourceDigest, TranscriptSegment } from "@/lib/sources/schema";
import type { ContentPack } from "@/lib/xhs/schema";

export type MemberRole = "owner" | "editor" | "reviewer" | "client_viewer";

export type Platform =
  | "x"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "xiaohongshu"
  | "wechat"
  | "zhihu"
  | "threads";

export type TopicStatus = "candidate" | "selected" | "scheduled" | "used" | "discarded";

export type ContentStatus =
  | "draft"
  | "compliance_check"
  | "pending_approval"
  | "approved"
  | "scheduled"
  | "published";

export type KnowledgeType =
  | "tone_guide"
  | "taboo_words"
  | "viral_post"
  | "brand_material"
  | "competitor";

export interface OrgSettings {
  approval_required: boolean;
  languages?: string[];
  platforms?: Platform[];
}

export interface Org {
  id: string;
  name: string;
  plan: string;
  quota: Record<string, number>;
  settings: OrgSettings;
}

export interface Workspace {
  id: string;
  org_id: string;
  name: string;
}

export interface AccountProfile {
  id: string;
  org_id: string;
  positioning: string;
  audience: string;
  tone: string;
  taboo: string[];
  benchmarks: string[];
  language: string;
}

export interface Account {
  id: string;
  org_id: string;
  workspace_id: string;
  platform: Platform;
  handle: string;
  profile_id: string | null;
  token_ref: string | null;
  /** 经 Buffer 发布时的频道 id */
  buffer_channel_id: string | null;
}

export interface NewsItem {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string;
  tags: string[];
  heat: number;
  fetched_at: string;
}

export interface Topic {
  id: string;
  org_id: string;
  account_id: string;
  news_ids: string[];
  title: string;
  angle: string;
  heat_score: number;
  relevance_score: number;
  score: number;
  status: TopicStatus;
  scheduled_week: string | null;
  /** 从素材出的选题：写文案时把素材带进提示词 */
  source_id?: string | null;
}

export type SourceStatus = "pending" | "transcribing" | "digesting" | "ready" | "failed";

/** 素材：一个视频或播客链接的文字稿和整理结果 */
export interface Source {
  id: string;
  org_id: string;
  workspace_id: string;
  url: string;
  platform: string;
  title: string;
  author: string;
  duration_seconds: number | null;
  lang: string | null;
  mode: "auto" | "native";
  status: SourceStatus;
  error: string | null;
  transcript: TranscriptSegment[] | null;
  digest: SourceDigest | null;
  created_at: string;
}

export interface Content {
  id: string;
  org_id: string;
  topic_id: string | null;
  account_id: string;
  variant: string;
  body: string;
  media_ids: string[];
  status: ContentStatus;
  compliance_hits: string[];
  /** 长文和小红书内容包的结构化部分（卡片、标题、检查结果） */
  pack: ContentPack | null;
  scheduled_at: string | null;
  /** 交给 Buffer 的图片地址（公开 HTTPS） */
  media_urls: string[];
  /** 推到 Telegram 审核的消息 id */
  telegram_message_id: number | null;
}

export interface Post {
  id: string;
  org_id: string;
  content_id: string;
  platform_post_id: string | null;
  published_at: string;
  method: "api" | "manual" | "buffer";
}

export interface MetricSnapshot {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  follows: number;
}
