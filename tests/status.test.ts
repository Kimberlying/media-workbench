import { describe, expect, it } from "vitest";
import { canTransition, nextStatus } from "@/lib/content/status";

const selfOrg = { approval_required: false };
const clientOrg = { approval_required: true };

describe("内容状态流转", () => {
  it("自用租户跳过审批：合规检查后直接已批准", () => {
    expect(nextStatus("compliance_check", selfOrg)).toBe("approved");
    expect(canTransition("compliance_check", "pending_approval", selfOrg)).toBe(false);
  });

  it("开审批的租户必须经过待审批", () => {
    expect(nextStatus("compliance_check", clientOrg)).toBe("pending_approval");
    expect(canTransition("compliance_check", "approved", clientOrg)).toBe(false);
    expect(canTransition("pending_approval", "approved", clientOrg)).toBe(true);
  });

  it("按顺序往前走，不能跳步", () => {
    expect(canTransition("draft", "compliance_check", selfOrg)).toBe(true);
    expect(canTransition("draft", "scheduled", selfOrg)).toBe(false);
    expect(canTransition("approved", "scheduled", selfOrg)).toBe(true);
    expect(canTransition("scheduled", "published", selfOrg)).toBe(true);
    expect(nextStatus("published", selfOrg)).toBeNull();
  });

  it("审批环节都能退回草稿，已发布和草稿本身不行", () => {
    for (const s of ["compliance_check", "pending_approval", "approved", "scheduled"] as const) {
      expect(canTransition(s, "draft", clientOrg)).toBe(true);
    }
    expect(canTransition("published", "draft", clientOrg)).toBe(false);
    expect(canTransition("draft", "draft", clientOrg)).toBe(false);
  });
});
