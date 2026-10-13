import type { Platform } from "@/lib/db/types";
import type { PlatformConnector } from "./types";

// 没有接 API 的平台：生成发布包（文案 + 图 + 话题），人工发布。
// 小红书、公众号始终走这里；IG / FB / LinkedIn 在二期接 API 之前也先走这里。
export function manualConnector(platform: Platform): PlatformConnector {
  return {
    platform,
    supportsApiPublish: false,

    async publish(input) {
      const hashtags = Array.from(input.body.matchAll(/#([^\s#]+)/g), (m) => m[1]);
      return {
        method: "manual",
        package: {
          platform,
          text: input.body,
          mediaUrls: input.mediaUrls ?? [],
          hashtags,
        },
      };
    },

    async fetchMetrics() {
      return new Map();
    },
  };
}
