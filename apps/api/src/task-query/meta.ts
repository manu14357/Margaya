import type { ColumnGroup } from "../column/groups";
import type { CycleStatus } from "../cycle/types";
import type { ModuleStatus } from "../module/types";
import { NONE_GROUP } from "./group";
import type {
  CustomFieldMeta,
  EstimatePointMeta,
  LabelMeta,
  MetaStore,
  TaskQueryRow,
  UserMeta,
} from "./hydrate";
import { LABEL_NAME_PREFIX } from "./keys/label";
import type { GroupByKey } from "./schema";

// Lookups for rendering group headers and cells: only entries the returned
// rows or group keys reference. Users are workspace members, without
// emails, and never on a public board.

export type ProjectMeta = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: number;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
};

export type ColumnMeta = {
  projectId: string;
  slug: string;
  name: string;
  icon: string | null;
  group: ColumnGroup;
  position: number;
  isFinal: boolean;
};

export type CycleMeta = {
  id: string;
  projectId: string;
  name: string;
  status: CycleStatus;
};

export type ModuleMeta = {
  id: string;
  projectId: string;
  name: string;
  status: ModuleStatus;
};

export type TaskQueryMeta = {
  users: UserMeta[];
  projects: ProjectMeta[];
  columns: ColumnMeta[];
  labels: LabelMeta[];
  cycles: CycleMeta[];
  modules: ModuleMeta[];
  estimatePoints: EstimatePointMeta[];
  customFields: CustomFieldMeta[];
};

type GroupLike = { key: string; subGroups?: { key: string }[] };

function keysFor(
  key: GroupByKey,
  groupBy: GroupByKey | null,
  subGroupBy: GroupByKey | null,
  groups: readonly GroupLike[],
): string[] {
  const keys: string[] = [];
  for (const group of groups) {
    if (groupBy === key) keys.push(group.key);
    if (subGroupBy === key) {
      for (const cell of group.subGroups ?? []) keys.push(cell.key);
    }
  }
  return keys.filter((value) => value !== NONE_GROUP);
}

function byName<T extends { name: string; id: string }>(a: T, b: T) {
  return (
    a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) ||
    a.id.localeCompare(b.id)
  );
}

export async function buildMeta(
  store: MetaStore,
  {
    rows,
    groupBy,
    subGroupBy,
    groups,
    includeCustomFields,
  }: {
    rows: readonly TaskQueryRow[];
    groupBy: GroupByKey | null;
    subGroupBy: GroupByKey | null;
    groups: readonly GroupLike[];
    includeCustomFields: boolean;
  },
): Promise<TaskQueryMeta> {
  const keys = (key: GroupByKey) => keysFor(key, groupBy, subGroupBy, groups);
  const { context } = store;

  const userIds = new Set<string>([...keys("assignee"), ...keys("createdBy")]);
  const cycleIds = new Set(keys("cycle"));
  const moduleIds = new Set(keys("module"));
  const pointIds = new Set(keys("estimate"));
  const projectIds = new Set<string>(keys("project"));
  if (groupBy === "status" || subGroupBy === "status") {
    for (const id of context.projectIds) projectIds.add(id);
  }
  for (const row of rows) {
    projectIds.add(row.projectId);
    if (row.userId) userIds.add(row.userId);
    if (row.createdBy) userIds.add(row.createdBy);
    for (const id of row.assigneeIds ?? []) userIds.add(id);
    if (row.cycleId) cycleIds.add(row.cycleId);
    for (const id of row.moduleIds ?? []) moduleIds.add(id);
    if (row.estimatePointId) pointIds.add(row.estimatePointId);
  }

  await store.loadUsers(userIds);
  await store.loadCycles(cycleIds);
  await store.loadModules(moduleIds);
  await store.loadPoints(pointIds);
  const labelKeys = [...keys("label")];
  await store.loadLabels(labelKeys, LABEL_NAME_PREFIX);

  const projects = context.projects.filter((project) =>
    projectIds.has(project.id),
  );

  return {
    users: context.publicContext
      ? []
      : [...userIds]
          .flatMap((id) => {
            const user = store.users.get(id);
            return user ? [user] : [];
          })
          .sort(byName),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      position: project.position,
      cyclesEnabled: project.cyclesEnabled,
      modulesEnabled: project.modulesEnabled,
      estimatesEnabled: project.estimatesEnabled,
    })),
    columns: projects.flatMap((project) =>
      project.columns
        .filter((column) => column.group !== "triage")
        .map((column) => ({
          projectId: column.projectId,
          slug: column.slug,
          name: column.name,
          icon: column.icon,
          group: column.group,
          position: column.position,
          isFinal: column.isFinal,
        })),
    ),
    labels: labelKeys.flatMap((key) => {
      const label = store.labels.get(key);
      return label ? [label] : [];
    }),
    cycles: [...cycleIds]
      .flatMap((id) => {
        const cycle = store.cycles.get(id);
        return cycle
          ? [
              {
                id: cycle.id,
                projectId: cycle.projectId,
                name: cycle.name,
                status: cycle.status,
              },
            ]
          : [];
      })
      .sort(byName),
    modules: [...moduleIds]
      .flatMap((id) => {
        const found = store.modules.get(id);
        return found ? [found] : [];
      })
      .sort(byName),
    estimatePoints: [...pointIds]
      .flatMap((id) => {
        const point = store.points.get(id);
        return point
          ? [
              {
                id: point.id,
                projectId: point.projectId,
                value: point.value,
                position: point.position,
                type: point.type,
              },
            ]
          : [];
      })
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    customFields: includeCustomFields
      ? await store.loadCustomFields(projects.map((project) => project.id))
      : [],
  };
}
