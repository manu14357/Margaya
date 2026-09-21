import type {
  TaskQueryGroup,
  TaskQueryMeta,
  TaskQueryResult,
  TaskQuerySubGroup,
} from "@/types/task-query";

// Merges a first page of grouped rows with the "load more" slices fetched
// for single groups or cells. Tasks are merged by id, so an offset page that
// repeats a row after a change never shows it twice.

export type MergedSubGroup = Omit<TaskQuerySubGroup, "taskIds"> & {
  taskIds: string[];
};

export type MergedGroup = Omit<TaskQueryGroup, "taskIds" | "subGroups"> & {
  taskIds: string[];
  subGroups?: MergedSubGroup[];
};

export type MergedTaskQueryResult = Omit<TaskQueryResult, "groups"> & {
  groups: MergedGroup[];
};

export type LoadMoreSlice = {
  group: string;
  subGroup?: string;
  result: TaskQueryResult;
};

function uniqueBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) seen.set(keyOf(item), item);
  return [...seen.values()];
}

export function mergeMeta(
  base: TaskQueryMeta,
  more: readonly TaskQueryMeta[],
): TaskQueryMeta {
  if (more.length === 0) return base;
  const all = [base, ...more];
  return {
    users: uniqueBy(
      all.flatMap((meta) => meta.users),
      (user) => user.id,
    ),
    projects: uniqueBy(
      all.flatMap((meta) => meta.projects),
      (project) => project.id,
    ),
    columns: uniqueBy(
      all.flatMap((meta) => meta.columns),
      (column) => `${column.projectId}:${column.slug}`,
    ),
    labels: uniqueBy(
      all.flatMap((meta) => meta.labels),
      (label) => label.key,
    ),
    cycles: uniqueBy(
      all.flatMap((meta) => meta.cycles),
      (cycle) => cycle.id,
    ),
    modules: uniqueBy(
      all.flatMap((meta) => meta.modules),
      (module) => module.id,
    ),
    estimatePoints: uniqueBy(
      all.flatMap((meta) => meta.estimatePoints),
      (point) => point.id,
    ),
    customFields: uniqueBy(
      all.flatMap((meta) => meta.customFields),
      (field) => field.id,
    ),
  };
}

function appendIds(target: string[], ids: readonly string[] | undefined) {
  if (!ids) return;
  const seen = new Set(target);
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      target.push(id);
    }
  }
}

function copyGroup(group: TaskQueryGroup): MergedGroup {
  const { subGroups, taskIds, ...rest } = group;
  return {
    ...rest,
    taskIds: [...(taskIds ?? [])],
    ...(subGroups
      ? {
          subGroups: subGroups.map((cell) => ({
            ...cell,
            taskIds: [...(cell.taskIds ?? [])],
          })),
        }
      : {}),
  };
}

export function mergeTaskQueryPages(
  base: TaskQueryResult,
  slices: readonly LoadMoreSlice[],
): MergedTaskQueryResult {
  const groups = base.groups.map(copyGroup);
  let tasks = base.tasks;
  for (const slice of slices) {
    const group = groups.find((candidate) => candidate.key === slice.group);
    const sliceGroup = slice.result.groups.find(
      (candidate) => candidate.key === slice.group,
    );
    if (!group || !sliceGroup) continue;
    tasks = { ...tasks, ...slice.result.tasks };
    if (slice.subGroup !== undefined) {
      const cell = group.subGroups?.find(
        (candidate) => candidate.key === slice.subGroup,
      );
      const sliceCell = sliceGroup.subGroups?.find(
        (candidate) => candidate.key === slice.subGroup,
      );
      if (!cell || !sliceCell) continue;
      appendIds(cell.taskIds, sliceCell.taskIds);
      cell.nextCursor = sliceCell.nextCursor;
      cell.count = sliceCell.count;
      continue;
    }
    appendIds(group.taskIds, sliceGroup.taskIds);
    group.nextCursor = sliceGroup.nextCursor;
    group.count = sliceGroup.count;
  }
  return {
    ...base,
    groups,
    tasks,
    meta: mergeMeta(
      base.meta,
      slices.map((slice) => slice.result.meta),
    ),
  };
}

/** The cursor that loads the next slice of a group or cell, if any. */
export function nextCursorOf(
  result: MergedTaskQueryResult | undefined,
  group: string,
  subGroup?: string,
): string | null {
  const found = result?.groups.find((candidate) => candidate.key === group);
  if (!found) return null;
  if (subGroup === undefined) return found.nextCursor;
  return (
    found.subGroups?.find((candidate) => candidate.key === subGroup)
      ?.nextCursor ?? null
  );
}
