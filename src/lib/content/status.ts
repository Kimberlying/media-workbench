import type { ContentStatus, OrgSettings } from "@/lib/db/types";

// 内容状态流转：草稿 → 合规检查 → 待审批 → 已批准 → 已排期 → 已发布
// 任一审批环节可退回草稿。自用租户关掉审批时，合规检查通过直接到已批准。

const FORWARD: Record<ContentStatus, ContentStatus | null> = {
  draft: "compliance_check",
  compliance_check: "pending_approval",
  pending_approval: "approved",
  approved: "scheduled",
  scheduled: "published",
  published: null,
};

const REJECTABLE: ReadonlySet<ContentStatus> = new Set([
  "compliance_check",
  "pending_approval",
  "approved",
  "scheduled",
]);

export function nextStatus(
  current: ContentStatus,
  settings: Pick<OrgSettings, "approval_required">,
): ContentStatus | null {
  const next = FORWARD[current];
  if (next === "pending_approval" && !settings.approval_required) {
    return "approved";
  }
  return next;
}

export function canTransition(
  from: ContentStatus,
  to: ContentStatus,
  settings: Pick<OrgSettings, "approval_required">,
): boolean {
  if (to === "draft") return REJECTABLE.has(from);
  return nextStatus(from, settings) === to;
}

export function assertTransition(
  from: ContentStatus,
  to: ContentStatus,
  settings: Pick<OrgSettings, "approval_required">,
): void {
  if (!canTransition(from, to, settings)) {
    throw new Error(`内容状态不能从 ${from} 变为 ${to}`);
  }
}

export const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: "草稿",
  compliance_check: "合规检查",
  pending_approval: "待审批",
  approved: "已批准",
  scheduled: "已排期",
  published: "已发布",
};
