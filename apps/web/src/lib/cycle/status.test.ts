import { describe, expect, it } from "vitest";
import type { CycleStatus } from "@/types/cycle";
import {
  canArchiveCycle,
  canDeleteCycle,
  canEditCycle,
  canTransfer,
  cycleDisplayStatus,
  isAssignableCycle,
} from "./status";

function cycle(
  status: CycleStatus,
  { archived = false, pending = 0, ownerId = "owner" } = {},
) {
  return {
    status,
    archivedAt: archived ? "2026-01-01T00:00:00.000Z" : null,
    pending,
    ownerId,
  };
}

describe("cycle status rules", () => {
  it("shows archived over the derived status", () => {
    expect(cycleDisplayStatus(cycle("completed", { archived: true }))).toBe(
      "archived",
    );
    expect(cycleDisplayStatus(cycle("current"))).toBe("current");
  });

  it("offers only current, upcoming and draft cycles as targets", () => {
    expect(isAssignableCycle(cycle("current"))).toBe(true);
    expect(isAssignableCycle(cycle("upcoming"))).toBe(true);
    expect(isAssignableCycle(cycle("draft"))).toBe(true);
    expect(isAssignableCycle(cycle("completed"))).toBe(false);
    expect(isAssignableCycle(cycle("completed", { archived: true }))).toBe(
      false,
    );
  });

  it("locks completed and archived cycles", () => {
    expect(canEditCycle(cycle("current"))).toBe(true);
    expect(canEditCycle(cycle("completed"))).toBe(false);
    expect(canArchiveCycle(cycle("completed"))).toBe(true);
    expect(canArchiveCycle(cycle("current"))).toBe(false);
    expect(canArchiveCycle(cycle("completed", { archived: true }))).toBe(false);
  });

  it("offers a transfer only with unfinished tasks in a completed cycle", () => {
    expect(canTransfer(cycle("completed", { pending: 2 }))).toBe(true);
    expect(canTransfer(cycle("completed", { pending: 0 }))).toBe(false);
    expect(canTransfer(cycle("current", { pending: 2 }))).toBe(false);
    expect(
      canTransfer(cycle("completed", { pending: 2, archived: true })),
    ).toBe(false);
  });

  it("lets admins or the owner delete open cycles", () => {
    const perms = { canDeleteCycles: false, canUpdateCycles: true };
    expect(canDeleteCycle(cycle("draft"), { ...perms, userId: "owner" })).toBe(
      true,
    );
    expect(canDeleteCycle(cycle("draft"), { ...perms, userId: "other" })).toBe(
      false,
    );
    expect(
      canDeleteCycle(cycle("draft"), {
        canDeleteCycles: false,
        canUpdateCycles: false,
        userId: "owner",
      }),
    ).toBe(false);
    expect(
      canDeleteCycle(cycle("current"), {
        canDeleteCycles: true,
        canUpdateCycles: false,
      }),
    ).toBe(true);
    expect(
      canDeleteCycle(cycle("completed"), {
        canDeleteCycles: true,
        canUpdateCycles: true,
      }),
    ).toBe(false);
  });
});
