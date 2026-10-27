import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../../apps/api/src/ai-agent/events", () => ({
  publishRunUpdated: vi.fn(),
}));

const { decisionLine, settledStatus } = await import(
  "../../../apps/api/src/ai-agent/run-state"
);

describe("settling a run after its approvals", () => {
  it("says what was approved, rejected and expired, in that order", () => {
    expect(
      decisionLine([
        { status: "rejected", label: "Delete WEB-2 Old" },
        { status: "approved", label: "Move WEB-1 Login to done" },
        { status: "expired", label: "Comment on WEB-1 Login" },
        { status: "approved", label: "Update title of WEB-1 Login" },
      ]),
    ).toBe(
      "Approved: Move WEB-1 Login to done; Update title of WEB-1 Login. Rejected: Delete WEB-2 Old. Expired without a decision: Comment on WEB-1 Login.",
    );
    expect(decisionLine([])).toBe("");
  });

  it("lists at most five changes per outcome", () => {
    const decided = Array.from({ length: 7 }, (_, i) => ({
      status: "rejected" as const,
      label: `C${i + 1}`,
    }));
    expect(decisionLine(decided)).toBe(
      "Rejected: C1; C2; C3; C4; C5; and 2 more.",
    );
  });

  it("succeeds when something changed, is cancelled when all was rejected, fails when it expired", () => {
    expect(
      settledStatus({
        decided: [{ status: "rejected", label: "a" }],
        appliedSteps: 1,
      }),
    ).toEqual({ status: "succeeded", error: null });
    expect(
      settledStatus({
        decided: [
          { status: "rejected", label: "a" },
          { status: "expired", label: "b" },
        ],
        appliedSteps: 0,
      }),
    ).toEqual({ status: "cancelled", error: null });
    expect(
      settledStatus({
        decided: [{ status: "expired", label: "a" }],
        appliedSteps: 0,
      }),
    ).toEqual({ status: "failed", error: "APPROVAL_EXPIRED" });
  });
});
