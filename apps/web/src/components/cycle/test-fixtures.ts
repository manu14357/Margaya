import type { Cycle } from "@/types/cycle";

/** A cycle as the API returns it, for component tests. */
export function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: "cycle-1",
    projectId: "project-1",
    name: "Sprint 1",
    description: "",
    startDate: "2026-03-01",
    endDate: "2026-03-14",
    ownerId: "owner-1",
    owner: { id: "owner-1", name: "Olivia Owner", image: null },
    sortOrder: 0,
    status: "current",
    today: "2026-03-05",
    archivedAt: null,
    isFrozen: false,
    counts: {
      total: 4,
      backlog: 1,
      unstarted: 1,
      started: 1,
      completed: 1,
      cancelled: 0,
    },
    pending: 3,
    progress: 25,
    rollover: null,
    createdBy: "owner-1",
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
    ...overrides,
  };
}
