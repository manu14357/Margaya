import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  activityTable,
  assetTable,
  columnTable,
  customFieldValueTable,
  cycleTable,
  cycleTaskTable,
  labelTable,
  moduleTable,
  moduleTaskTable,
  pageTable,
  projectTable,
  taskAssigneeTable,
  taskRelationTable,
  taskTable,
  timeEntryTable,
} from "../database/schema";
import { canSeeProject } from "../project/visibility";
import { openSecret, sealSecret } from "../utils/secret-box";
import type { InternalApi } from "./dispatch";

// Undoing an applied plan. Like chat Build mode it needs no table: applying
// returns a sealed token (keyed from AUTH_SECRET) holding what was created,
// its owner, its workspace and an expiry one hour out.
//
// Like an agent's page undo, it only runs while the items are as the plan left
// them: the token holds a fingerprint of each item, and if any differs now,
// nothing is undone and the answer names what changed. Removal then goes
// through the ordinary routes with the caller's own rights, so permissions,
// events and activity hold; deleted items land in the trash.

const UNDO_PURPOSE = "ai-build-undo";
export const BUILD_UNDO_TTL_MS = 60 * 60 * 1000;
// A refusal names this many items; `total` says how many there were.
const MAX_NAMED_ITEMS = 10;

/** The ids of what a run created, filled in as it goes. */
export type BuildLedger = {
  project: string | null;
  columns: string[];
  cycles: string[];
  modules: string[];
  tasks: string[];
  subtasks: string[];
};

export function emptyLedger(): BuildLedger {
  return {
    project: null,
    columns: [],
    cycles: [],
    modules: [],
    tasks: [],
    subtasks: [],
  };
}

const ITEM_KINDS = [
  "project",
  "column",
  "cycle",
  "module",
  "task",
  "subtask",
] as const;
type ItemKind = (typeof ITEM_KINDS)[number];

type Item = { name: string; fingerprint: string };
type Current = Map<string, Item>;

/** [id, fingerprint] of each item when the run ended. */
type Stamped = [string, string][];

type UndoClaims = {
  v: 1;
  userId: string;
  workspaceId: string;
  exp: number;
  projectId: string;
  newProject: boolean;
  project: string | null;
  columns: Stamped;
  cycles: Stamped;
  modules: Stamped;
  tasks: Stamped;
  subtasks: Stamped;
};

function fingerprint(values: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(values))
    .digest("base64url")
    .slice(0, 16);
}

/** One sorted list per id, of whatever hangs off it. */
function collect(rows: readonly (readonly [string | null, string])[]) {
  const byId = new Map<string, string[]>();
  for (const [id, value] of rows) {
    if (id) byId.set(id, [...(byId.get(id) ?? []), value]);
  }
  for (const values of byId.values()) values.sort();
  return byId;
}

// A task's edits show in its own fields or in what hangs off it. `position`
// is left out (moving other cards renumbers it) and so are `updatedAt` and
// the activity feed, which background work touches. Archived and trashed
// items count as gone: there is nothing left to undo on them.
async function currentTasks(ids: readonly string[]): Promise<Current> {
  if (ids.length === 0) return new Map();
  const list = [...ids];
  const tasks = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      description: taskTable.description,
      priority: taskTable.priority,
      status: taskTable.status,
      columnId: taskTable.columnId,
      userId: taskTable.userId,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      estimatePointId: taskTable.estimatePointId,
    })
    .from(taskTable)
    .where(
      and(
        inArray(taskTable.id, list),
        isNull(taskTable.deletedAt),
        isNull(taskTable.archivedAt),
      ),
    );
  const [
    assignees,
    labels,
    comments,
    entries,
    assets,
    relations,
    fields,
    cycles,
    modules,
  ] = await Promise.all([
    db
      .select({
        taskId: taskAssigneeTable.taskId,
        value: taskAssigneeTable.userId,
      })
      .from(taskAssigneeTable)
      .where(inArray(taskAssigneeTable.taskId, list)),
    db
      .select({
        taskId: labelTable.taskId,
        value: sql<string>`${labelTable.name} || ':' || ${labelTable.color}`,
      })
      .from(labelTable)
      .where(inArray(labelTable.taskId, list)),
    // Comments live in the activity table; other activity rows are written in
    // the background and don't say whether anyone touched the task.
    db
      .select({ taskId: activityTable.taskId, value: activityTable.id })
      .from(activityTable)
      .where(
        and(
          inArray(activityTable.taskId, list),
          eq(activityTable.type, "comment"),
        ),
      ),
    db
      .select({ taskId: timeEntryTable.taskId, value: timeEntryTable.id })
      .from(timeEntryTable)
      .where(inArray(timeEntryTable.taskId, list)),
    db
      .select({ taskId: assetTable.taskId, value: assetTable.id })
      .from(assetTable)
      .where(inArray(assetTable.taskId, list)),
    db
      .select({
        id: taskRelationTable.id,
        sourceTaskId: taskRelationTable.sourceTaskId,
        targetTaskId: taskRelationTable.targetTaskId,
      })
      .from(taskRelationTable)
      .where(
        or(
          inArray(taskRelationTable.sourceTaskId, list),
          inArray(taskRelationTable.targetTaskId, list),
        ),
      ),
    db
      .select({
        taskId: customFieldValueTable.taskId,
        value: sql<string>`${customFieldValueTable.fieldId} || ':' || coalesce(${customFieldValueTable.value}, '')`,
      })
      .from(customFieldValueTable)
      .where(inArray(customFieldValueTable.taskId, list)),
    db
      .select({ taskId: cycleTaskTable.taskId, value: cycleTaskTable.cycleId })
      .from(cycleTaskTable)
      .where(inArray(cycleTaskTable.taskId, list)),
    db
      .select({
        taskId: moduleTaskTable.taskId,
        value: moduleTaskTable.moduleId,
      })
      .from(moduleTaskTable)
      .where(inArray(moduleTaskTable.taskId, list)),
  ]);

  const related = [
    assignees,
    labels,
    comments,
    entries,
    assets,
    fields,
    cycles,
    modules,
  ]
    .map((rows) => collect(rows.map((row) => [row.taskId, row.value] as const)))
    .concat(
      collect(
        relations.flatMap((row) => [
          [row.sourceTaskId, row.id] as const,
          [row.targetTaskId, row.id] as const,
        ]),
      ),
    );

  return new Map(
    tasks.map((task) => [
      task.id,
      {
        name: task.title,
        fingerprint: fingerprint([
          task,
          related.map((byId) => byId.get(task.id) ?? []),
        ]),
      },
    ]),
  );
}

async function currentCycles(ids: readonly string[]): Promise<Current> {
  if (ids.length === 0) return new Map();
  const [cycles, members] = await Promise.all([
    db
      .select({
        id: cycleTable.id,
        name: cycleTable.name,
        description: cycleTable.description,
        startDate: cycleTable.startDate,
        endDate: cycleTable.endDate,
        ownerId: cycleTable.ownerId,
      })
      .from(cycleTable)
      .where(
        and(inArray(cycleTable.id, [...ids]), isNull(cycleTable.archivedAt)),
      ),
    db
      .select({ id: cycleTaskTable.cycleId, taskId: cycleTaskTable.taskId })
      .from(cycleTaskTable)
      .where(inArray(cycleTaskTable.cycleId, [...ids])),
  ]);
  const byCycle = collect(members.map((row) => [row.id, row.taskId] as const));
  return new Map(
    cycles.map((cycle) => [
      cycle.id,
      {
        name: cycle.name,
        fingerprint: fingerprint([cycle, byCycle.get(cycle.id) ?? []]),
      },
    ]),
  );
}

async function currentModules(ids: readonly string[]): Promise<Current> {
  if (ids.length === 0) return new Map();
  const [modules, members] = await Promise.all([
    db
      .select({
        id: moduleTable.id,
        name: moduleTable.name,
        description: moduleTable.description,
        status: moduleTable.status,
        startDate: moduleTable.startDate,
        targetDate: moduleTable.targetDate,
        leadId: moduleTable.leadId,
      })
      .from(moduleTable)
      .where(
        and(inArray(moduleTable.id, [...ids]), isNull(moduleTable.archivedAt)),
      ),
    db
      .select({ id: moduleTaskTable.moduleId, taskId: moduleTaskTable.taskId })
      .from(moduleTaskTable)
      .where(inArray(moduleTaskTable.moduleId, [...ids])),
  ]);
  const byModule = collect(members.map((row) => [row.id, row.taskId] as const));
  return new Map(
    modules.map((module) => [
      module.id,
      {
        name: module.name,
        fingerprint: fingerprint([module, byModule.get(module.id) ?? []]),
      },
    ]),
  );
}

async function currentColumns(ids: readonly string[]): Promise<Current> {
  if (ids.length === 0) return new Map();
  const [columns, tasks] = await Promise.all([
    db
      .select({
        id: columnTable.id,
        name: columnTable.name,
        slug: columnTable.slug,
        icon: columnTable.icon,
        color: columnTable.color,
        group: columnTable.group,
      })
      .from(columnTable)
      .where(inArray(columnTable.id, [...ids])),
    // Someone else's task moved in also blocks deleting the column.
    db
      .select({ id: taskTable.columnId, taskId: taskTable.id })
      .from(taskTable)
      .where(
        and(
          inArray(taskTable.columnId, [...ids]),
          isNull(taskTable.deletedAt),
          isNull(taskTable.archivedAt),
        ),
      ),
  ]);
  const byColumn = collect(tasks.map((row) => [row.id, row.taskId] as const));
  return new Map(
    columns.map((column) => [
      column.id,
      {
        name: column.name,
        fingerprint: fingerprint([column, byColumn.get(column.id) ?? []]),
      },
    ]),
  );
}

async function currentProject(id: string | null): Promise<Current> {
  if (!id) return new Map();
  const [project] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      icon: projectTable.icon,
      description: projectTable.description,
      isPublic: projectTable.isPublic,
      visibility: projectTable.visibility,
      leadUserId: projectTable.leadUserId,
      defaultAssigneeUserId: projectTable.defaultAssigneeUserId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
      ),
    );
  if (!project) return new Map();
  // Anything added to a new project would go with it.
  const [tasks, columns, cycles, modules, pages] = await Promise.all([
    db
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(and(eq(taskTable.projectId, id), isNull(taskTable.deletedAt))),
    db
      .select({ id: columnTable.id })
      .from(columnTable)
      .where(eq(columnTable.projectId, id)),
    db
      .select({ id: cycleTable.id })
      .from(cycleTable)
      .where(eq(cycleTable.projectId, id)),
    db
      .select({ id: moduleTable.id })
      .from(moduleTable)
      .where(eq(moduleTable.projectId, id)),
    db
      .select({ id: pageTable.id })
      .from(pageTable)
      .where(eq(pageTable.projectId, id)),
  ]);
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
  return new Map([
    [
      id,
      {
        name: project.name,
        fingerprint: fingerprint([
          project,
          ids(tasks),
          ids(columns),
          ids(cycles),
          ids(modules),
          ids(pages),
        ]),
      },
    ],
  ]);
}

async function currentItems(ids: {
  project: string | null;
  columns: readonly string[];
  cycles: readonly string[];
  modules: readonly string[];
  tasks: readonly string[];
  subtasks: readonly string[];
}) {
  const [project, columns, cycles, modules, tasks, subtasks] =
    await Promise.all([
      currentProject(ids.project),
      currentColumns(ids.columns),
      currentCycles(ids.cycles),
      currentModules(ids.modules),
      currentTasks(ids.tasks),
      currentTasks(ids.subtasks),
    ]);
  return { project, columns, cycles, modules, tasks, subtasks };
}

function stamp(ids: readonly string[], current: Current): Stamped {
  return ids.flatMap((id): Stamped => {
    const item = current.get(id);
    return item ? [[id, item.fingerprint]] : [];
  });
}

/**
 * The undo token of a finished run, or undefined when it created nothing.
 * Taken when the run ends, so its own later steps (labels, cycle membership)
 * don't read as edits.
 */
export async function sealBuildUndo(input: {
  ledger: BuildLedger;
  userId: string;
  workspaceId: string;
  projectId: string | null;
  now?: number;
}): Promise<string | undefined> {
  const { ledger } = input;
  if (!input.projectId) return undefined;
  const current = await currentItems(ledger);
  const claims: UndoClaims = {
    v: 1,
    userId: input.userId,
    workspaceId: input.workspaceId,
    exp: (input.now ?? Date.now()) + BUILD_UNDO_TTL_MS,
    projectId: input.projectId,
    newProject: ledger.project !== null,
    project: current.project.get(ledger.project ?? "")?.fingerprint ?? null,
    columns: stamp(ledger.columns, current.columns),
    cycles: stamp(ledger.cycles, current.cycles),
    modules: stamp(ledger.modules, current.modules),
    tasks: stamp(ledger.tasks, current.tasks),
    subtasks: stamp(ledger.subtasks, current.subtasks),
  };
  const empty =
    !claims.project &&
    claims.columns.length +
      claims.cycles.length +
      claims.modules.length +
      claims.tasks.length +
      claims.subtasks.length ===
      0;
  return empty ? undefined : sealSecret(UNDO_PURPOSE, JSON.stringify(claims));
}

function openBuildUndo(token: string): UndoClaims | null {
  try {
    const claims = JSON.parse(openSecret(UNDO_PURPOSE, token)) as UndoClaims;
    return claims?.v === 1 ? claims : null;
  } catch {
    return null;
  }
}

const enc = encodeURIComponent;

export type BuildUndoRefusal = {
  code: "BUILD_EDITED" | "BUILD_ALREADY_UNDONE";
  message: string;
  items: { kind: ItemKind; name: string }[];
  total: number;
};

export type BuildUndoResult = {
  removed: {
    project: boolean;
    columns: number;
    cycles: number;
    modules: number;
    tasks: number;
    subtasks: number;
  };
  /** Items archived instead, because the caller may not delete them. */
  archived: number;
  failures: { kind: ItemKind; name: string; status: number; message: string }[];
};

/**
 * Reverts an applied plan, or says why it won't: a refusal changes nothing.
 * A retry after a partial failure works, since items already removed count
 * as gone. Throws 404 for a token that isn't the caller's and 410 once expired.
 */
export async function undoBuild(input: {
  call: InternalApi;
  token: string;
  userId: string;
  workspaceId: string;
  now?: number;
}): Promise<BuildUndoResult | BuildUndoRefusal> {
  const claims = openBuildUndo(input.token);
  // Someone else's token reads as an unknown one.
  if (
    !claims ||
    claims.userId !== input.userId ||
    claims.workspaceId !== input.workspaceId
  ) {
    throw new HTTPException(404, { message: "Nothing to undo" });
  }
  if (claims.exp <= (input.now ?? Date.now())) {
    throw new HTTPException(410, { message: "Undo has expired" });
  }
  if (!(await canSeeProject(input.userId, claims.projectId))) {
    throw new HTTPException(404, { message: "Nothing to undo" });
  }

  const ids = (stamped: Stamped) => stamped.map(([id]) => id);
  const current = await currentItems({
    project: claims.newProject ? claims.projectId : null,
    columns: ids(claims.columns),
    cycles: ids(claims.cycles),
    modules: ids(claims.modules),
    tasks: ids(claims.tasks),
    subtasks: ids(claims.subtasks),
  });

  const edited: { kind: ItemKind; name: string }[] = [];
  const compare = (kind: ItemKind, stamped: Stamped, items: Current) => {
    const live: string[] = [];
    for (const [id, expected] of stamped) {
      const item = items.get(id);
      if (!item) continue;
      live.push(id);
      if (item.fingerprint !== expected) edited.push({ kind, name: item.name });
    }
    return live;
  };
  const tasks = compare("task", claims.tasks, current.tasks);
  const subtasks = compare("subtask", claims.subtasks, current.subtasks);
  const cycles = compare("cycle", claims.cycles, current.cycles);
  const modules = compare("module", claims.modules, current.modules);
  const columns = compare("column", claims.columns, current.columns);
  const project = claims.project
    ? compare("project", [[claims.projectId, claims.project]], current.project)
    : [];

  if (edited.length > 0) {
    return {
      code: "BUILD_EDITED",
      message:
        "Nothing was undone: these items changed after the plan was created. Remove them by hand if you still want them gone.",
      items: edited.slice(0, MAX_NAMED_ITEMS),
      total: edited.length,
    };
  }
  if (
    tasks.length +
      subtasks.length +
      cycles.length +
      modules.length +
      columns.length +
      project.length ===
    0
  ) {
    return {
      code: "BUILD_ALREADY_UNDONE",
      message: "This plan was already undone, or its items are gone.",
      items: [],
      total: 0,
    };
  }

  const result: BuildUndoResult = {
    removed: {
      project: false,
      columns: 0,
      cycles: 0,
      modules: 0,
      tasks: 0,
      subtasks: 0,
    },
    archived: 0,
    failures: [],
  };
  const fail = (
    kind: ItemKind,
    name: string,
    failure: { status: number; message: string },
  ) => {
    result.failures.push({
      kind,
      name: name.slice(0, 255),
      status: failure.status,
      message: failure.message,
    });
  };
  const { call } = input;

  // Deleted when the caller may, else archived, as chat Build mode does.
  // Gone already (a sub-task trashed with its parent) is fine.
  const removeOrArchive = async (
    remove: string,
    archive: { method: "POST" | "PUT"; path: string },
  ): Promise<"removed" | "archived" | { status: number; message: string }> => {
    const removed = await call("DELETE", remove);
    if (removed.ok || removed.status === 404) return "removed";
    if (removed.status !== 403) return removed;
    const archived = await call(archive.method, archive.path);
    if (archived.ok) return "archived";
    return archived.status === 404 ? "removed" : archived;
  };

  // A new project takes everything in it along, and comes back as one from
  // the trash.
  if (project[0]) {
    const outcome = await removeOrArchive(`/project/${enc(project[0])}`, {
      method: "PUT",
      path: `/project/${enc(project[0])}/archive`,
    });
    if (typeof outcome === "object") {
      fail("project", current.project.get(project[0])?.name ?? "", outcome);
      return result;
    }
    if (outcome === "archived") result.archived += 1;
    else result.removed.project = true;
    return result;
  }

  // Parents first, so sub-tasks go to the trash in their parent's batch.
  for (const [kind, list, items] of [
    ["task", tasks, current.tasks],
    ["subtask", subtasks, current.subtasks],
  ] as const) {
    for (const id of list) {
      const outcome = await removeOrArchive(`/task/${enc(id)}`, {
        method: "POST",
        path: `/task/archive/${enc(id)}`,
      });
      if (typeof outcome === "object") {
        fail(kind, items.get(id)?.name ?? "", outcome);
      } else if (outcome === "archived") {
        result.archived += 1;
      } else if (kind === "task") {
        result.removed.tasks += 1;
      } else {
        result.removed.subtasks += 1;
      }
    }
  }

  const removeEach = async (
    kind: "cycle" | "module" | "column",
    list: readonly string[],
    items: Current,
    onRemoved: () => void,
  ) => {
    for (const id of list) {
      const removed = await call("DELETE", `/${kind}/${enc(id)}`);
      if (removed.ok || removed.status === 404) onRemoved();
      else fail(kind, items.get(id)?.name ?? "", removed);
    }
  };
  await removeEach("cycle", cycles, current.cycles, () => {
    result.removed.cycles += 1;
  });
  await removeEach("module", modules, current.modules, () => {
    result.removed.modules += 1;
  });
  // Last: a column can't be deleted while it holds tasks.
  await removeEach("column", columns, current.columns, () => {
    result.removed.columns += 1;
  });

  return result;
}

export function isBuildUndoRefusal(
  value: BuildUndoResult | BuildUndoRefusal,
): value is BuildUndoRefusal {
  return "code" in value;
}
