import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));

const { toCycle } = await import(
  "../../../apps/api/src/cycle/controllers/shared"
);

const frozenCounts = {
  total: 4,
  backlog: 1,
  unstarted: 1,
  started: 1,
  completed: 1,
  cancelled: 0,
};

function row(progressSnapshot: unknown) {
  return {
    id: "cycle-1",
    projectId: "project-1",
    name: "Sprint 1",
    description: "",
    startDate: "2026-03-01",
    endDate: "2026-03-14",
    ownerId: null,
    owner: null,
    sortOrder: 0,
    archivedAt: null,
    progressSnapshot,
    rolledOverAt: null,
    rolloverResult: null,
    createdBy: null,
    createdAt: new Date("2026-02-20T00:00:00.000Z"),
    updatedAt: new Date("2026-02-20T00:00:00.000Z"),
  } as unknown as Parameters<typeof toCycle>[0];
}

describe("toCycle", () => {
  it("keeps the frozen report but counts what is left to transfer live", () => {
    const snapshot = { counts: frozenCounts, pending: 3, progress: 25 };
    // After the transfer only the finished task is still in the cycle.
    const live = {
      ...frozenCounts,
      total: 1,
      backlog: 0,
      unstarted: 0,
      started: 0,
    };

    const cycle = toCycle(row(snapshot), live, "2026-03-20");

    expect(cycle).toMatchObject({
      status: "completed",
      isFrozen: true,
      counts: frozenCounts,
      pending: 3,
      progress: 25,
      transferable: 0,
    });
  });

  it("matches pending while nothing is frozen", () => {
    const cycle = toCycle(row(null), frozenCounts, "2026-03-20");
    expect(cycle.pending).toBe(3);
    expect(cycle.transferable).toBe(3);
  });

  it("has nothing to transfer without tasks", () => {
    expect(toCycle(row(null), undefined, "2026-03-20").transferable).toBe(0);
  });
});
