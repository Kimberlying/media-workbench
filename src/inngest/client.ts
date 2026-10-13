import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "media-workbench" });

// 事件名
export const EVENTS = {
  topicsRequested: "topics/plan.requested",
  contentsRequested: "contents/generate.requested",
} as const;
