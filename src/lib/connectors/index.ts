import { formatOfVariant } from "@/lib/content/formats";
import type { Platform } from "@/lib/db/types";
import { manualConnector } from "./manual";
import type { PlatformConnector } from "./types";
import { xConnector } from "./x";

export type { PlatformConnector, PublishInput, PublishResult, PublishPackage } from "./types";
export { PublishRejected, splitThread } from "./types";

const registry: Record<Platform, PlatformConnector> = {
  x: xConnector,
  instagram: manualConnector("instagram"),
  facebook: manualConnector("facebook"),
  linkedin: manualConnector("linkedin"),
  xiaohongshu: manualConnector("xiaohongshu"),
  wechat: manualConnector("wechat"),
};

export function getConnector(platform: Platform): PlatformConnector {
  return registry[platform];
}

/** 这条内容能不能走 API 自动发布：平台支持，且这种形式有发布接口（X 长文没有） */
export function publishesViaApi(platform: Platform, variant: string): boolean {
  if (!registry[platform].supportsApiPublish) return false;
  try {
    return formatOfVariant(variant).apiPublish;
  } catch {
    return false;
  }
}
