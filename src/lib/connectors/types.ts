import type { MetricSnapshot, Platform } from "@/lib/db/types";

// 每个平台是一个连接器，实现统一的发布和取数接口。
// 新增平台只加连接器并在 registry 注册，不改主流程。

export interface PublishInput {
  /** 正文；推文串用单独一行 `---` 分隔每条 */
  body: string;
  mediaUrls?: string[];
}

export type PublishResult =
  | { method: "api"; platformPostId: string }
  /** 没有开放发布接口的平台：生成发布包，人工发 */
  | { method: "manual"; package: PublishPackage };

export interface PublishPackage {
  platform: Platform;
  text: string;
  mediaUrls: string[];
  hashtags: string[];
}

export interface ConnectorContext {
  /** 已解密的用户授权令牌；只在服务端任务里出现 */
  accessToken: string | null;
  fetch?: typeof fetch;
}

export interface PlatformConnector {
  platform: Platform;
  supportsApiPublish: boolean;
  publish(input: PublishInput, ctx: ConnectorContext): Promise<PublishResult>;
  /** 按平台帖子 id 批量取数；无 API 的平台返回空 */
  fetchMetrics(postIds: string[], ctx: ConnectorContext): Promise<Map<string, MetricSnapshot>>;
}

/**
 * 平台明确拒绝、确定什么都没发出去时抛这个。
 * 其他错误（网络中断、推文串发到一半）都算「结果不确定」，不能自动重发。
 */
export class PublishRejected extends Error {}

export function splitThread(body: string): string[] {
  return body
    .split(/^\s*---\s*$/m)
    .map((part) => part.trim())
    .filter(Boolean);
}
