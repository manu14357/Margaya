import type { OrderLookup } from "../../../apps/api/src/analytics/order";
import type { QueryContext } from "../../../apps/api/src/task-query/context";
import type { CycleGroupMeta } from "../../../apps/api/src/task-query/group";

// A minimal ordering lookup for the pure analytics helpers: one project
// "web" with a few columns, and whatever users, cycles and modules a test
// names.

const columns = [
  { slug: "to-do", position: 0, group: "unstarted" },
  { slug: "doing", position: 1, group: "started" },
  { slug: "done", position: 2, group: "completed" },
].map((column) => ({
  ...column,
  id: column.slug,
  projectId: "web",
  name: column.slug,
  icon: null,
  isFinal: column.group === "completed",
}));

export function fakeContext(projectIds = ["web", "api"]): QueryContext {
  const projects = projectIds.map((id, position) => ({
    id,
    name: id,
    slug: id,
    icon: null,
    position,
    createdAt: new Date(0),
    archivedAt: null,
    cyclesEnabled: true,
    modulesEnabled: true,
    estimatesEnabled: true,
    intakeEnabled: false,
    columns: id === "web" ? columns : [],
  }));
  return {
    workspaceId: "ws",
    userId: "me",
    publicContext: false,
    timeZone: "UTC",
    weekStartsOn: 0,
    today: "2026-03-25",
    utcToday: "2026-03-25",
    projects,
    projectIds,
    projectById: new Map(projects.map((project) => [project.id, project])),
    featureProjectIds: {
      cycles: projectIds,
      modules: projectIds,
      estimates: projectIds,
    },
    customFields: new Map(),
  } as QueryContext;
}

export function fakeLookup(
  overrides: Partial<{
    context: QueryContext;
    users: Array<{ id: string; name: string }>;
    cycles: Array<Partial<CycleGroupMeta> & { id: string; name: string }>;
    modules: Array<{ id: string; name: string; status: string }>;
    estimates: Array<{ key: string; position: number }>;
  }> = {},
): OrderLookup {
  return {
    context: overrides.context ?? fakeContext(),
    users: new Map(
      (overrides.users ?? []).map((user) => [
        user.id,
        { ...user, image: null },
      ]),
    ),
    cycles: new Map(
      (overrides.cycles ?? []).map((cycle) => [
        cycle.id,
        {
          projectId: "web",
          status: "current",
          startDate: null,
          endDate: null,
          sortOrder: 0,
          createdAt: new Date(0),
          ...cycle,
        } as CycleGroupMeta,
      ]),
    ),
    modules: new Map(
      (overrides.modules ?? []).map((found) => [
        found.id,
        { ...found, projectId: "web" } as never,
      ]),
    ),
    points: new Map(),
    estimates: new Map(
      (overrides.estimates ?? []).map((entry) => {
        const [type, value] = entry.key.split(":") as [string, string];
        return [
          entry.key,
          {
            key: entry.key,
            type: type as "points",
            value,
            position: entry.position,
          },
        ];
      }),
    ),
  };
}
