import type { Module, ModuleDetail } from "@/types/module";

/** A module as the API returns it, for component tests. */
export function makeModule(overrides: Partial<Module> = {}): Module {
  return {
    id: "module-1",
    projectId: "project-1",
    name: "Billing v2",
    description: null,
    status: "in-progress",
    startDate: "2026-03-01",
    targetDate: "2026-03-31",
    leadId: "lead-1",
    lead: { id: "lead-1", name: "Lena Lead", image: null },
    memberIds: [],
    position: 0,
    archivedAt: null,
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
    createdBy: "creator-1",
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
    ...overrides,
  };
}

export function makeModuleDetail(
  overrides: Partial<ModuleDetail> = {},
): ModuleDetail {
  return { ...makeModule(overrides), links: [], members: [], ...overrides };
}
