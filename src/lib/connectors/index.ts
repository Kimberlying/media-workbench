import type { Platform } from "@/lib/db/types";
import { manualConnector } from "./manual";
import type { PlatformConnector } from "./types";
import { xConnector } from "./x";

export type { PlatformConnector, PublishInput, PublishResult, PublishPackage } from "./types";
export { splitThread } from "./types";

const registry: Record<Platform, PlatformConnector> = {
  x: xConnector,
  instagram: manualConnector("instagram"),
  facebook: manualConnector("facebook"),
  linkedin: manualConnector("linkedin"),
  xiaohongshu: manualConnector("xiaohongshu"),
};

export function getConnector(platform: Platform): PlatformConnector {
  return registry[platform];
}
