import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  cycleTable,
  moduleTable,
  projectTable,
} from "../database/schema";
import { notHiddenProject } from "../project/visibility";

// Activity rows keep snapshots of other tasks and projects (keys, titles, ids,
// names), so history stays readable after renames and deletes. A snapshot can
// name a project the reader may not see, and it outlives the link it records,
// so every reader of these rows redacts here, at read time. The stored row
// stays whole: whoever can see the project still gets the full text.
//
// A snapshot is only readable when its project is known to be within reach. A
// project purged since, or one of another workspace (legacy links), can't be
// shown to be visible, so it reads as hidden for everyone.

type Data = Record<string, unknown>;

type OwnerTable = "cycle" | "module";

type Reference = {
  /** The field holding the id of the project the snapshot belongs to. */
  project: string;
  /** The other fields that say something about the snapshot. */
  details: readonly string[];
  /** Set to true on a redacted row, whose reference fields all become null. */
  hiddenFlag: string;
  /**
   * Older rows store no project: the id that leads to it. One that no longer
   * resolves (a purged cycle or module) reads as hidden.
   */
  owner?: { table: OwnerTable; id: string };
};

const OTHER_TASK: Reference = {
  project: "otherProjectId",
  details: ["otherTaskId", "otherTaskKey", "otherTaskTitle"],
  hiddenFlag: "otherTaskHidden",
};

const MODULE: Reference = {
  project: "moduleProjectId",
  details: ["moduleId", "moduleName"],
  hiddenFlag: "moduleHidden",
  owner: { table: "module", id: "moduleId" },
};

function sourceTask(project: string): Reference {
  return {
    project,
    details: ["sourceTaskId", "sourceTaskKey", "sourceTaskTitle"],
    hiddenFlag: "sourceTaskHidden",
  };
}

function cycleSide(side: "old" | "new"): Reference {
  const id = `${side}CycleId`;
  return {
    project: `${side}CycleProjectId`,
    details: [id, `${side}CycleName`],
    hiddenFlag: `${side}CycleHidden`,
    owner: { table: "cycle", id },
  };
}

const REFERENCES: Record<string, readonly Reference[]> = {
  relation_added: [OTHER_TASK],
  relation_removed: [OTHER_TASK],
  subtask_added: [OTHER_TASK],
  subtask_removed: [OTHER_TASK],
  copied_from: [sourceTask("sourceProjectId")],
  copied_to: [
    {
      project: "copyProjectId",
      details: ["copyTaskId", "copyTaskKey", "copyTaskTitle"],
      hiddenFlag: "copyTaskHidden",
    },
  ],
  // Written within one project, but the task can move out of it later.
  recurred_from: [sourceTask("projectId")],
  recurred_to: [
    {
      project: "projectId",
      details: ["nextTaskId", "nextTaskKey", "nextTaskTitle"],
      hiddenFlag: "nextTaskHidden",
    },
  ],
  // A status is a column slug of that project's workflow.
  moved: [
    {
      project: "fromProjectId",
      details: ["fromProjectName", "oldStatus"],
      hiddenFlag: "fromProjectHidden",
    },
    {
      project: "toProjectId",
      details: ["toProjectName", "newStatus"],
      hiddenFlag: "toProjectHidden",
    },
  ],
  cycle_changed: [cycleSide("old"), cycleSide("new")],
  module_added: [MODULE],
  module_removed: [MODULE],
  // A task of a project copied from another one.
  create: [
    {
      project: "copiedFromProjectId",
      details: [],
      hiddenFlag: "copiedFromHidden",
    },
  ],
};

/** parent_changed holds whole task references instead of flat fields. */
const PARENT_FIELDS = ["oldParent", "newParent"] as const;

const HIDDEN_PARENT = {
  id: null,
  key: null,
  title: null,
  projectId: null,
  hidden: true,
};

/**
 * Rows that describe the project the task was in when they were written, and
 * name no project: its column slugs, a duplicate in that project. The task
 * can move out of it later, and its next `moved` row says where it was.
 */
const WRITTEN_IN_PROJECT: Record<
  string,
  Pick<Reference, "details" | "hiddenFlag">
> = {
  status_changed: {
    details: ["oldStatus", "newStatus"],
    hiddenFlag: "statusHidden",
  },
  intake_accepted: {
    details: ["columnName", "status"],
    hiddenFlag: "columnHidden",
  },
  intake_duplicate: {
    details: ["duplicateOfTaskId", "duplicateKey", "duplicateTitle"],
    hiddenFlag: "duplicateHidden",
  },
};

export type RedactableRow = {
  taskId: string;
  type: string;
  createdAt: Date;
  eventData: unknown;
};

type Lookups = {
  /** Cycle and module ids of older rows, each with its project. */
  owners: Record<OwnerTable, ReadonlyMap<string, string>>;
  /** Each task's moves, oldest first. */
  moves: ReadonlyMap<string, readonly { at: Date; from: unknown }[]>;
};

function isData(value: unknown): value is Data {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The name of the automation rule that wrote a row (automation-rule/context). */
function ruleNameOf(data: Data): unknown {
  return isData(data.automation) ? data.automation.ruleName : null;
}

/** Whether a row says something about the project it was written in. */
function describesItsProject(type: string, data: Data): boolean {
  return Boolean(WRITTEN_IN_PROJECT[type]) || Boolean(ruleNameOf(data));
}

function referencedProject(
  { project, owner }: Reference,
  data: Data,
  lookups: Lookups,
): unknown {
  if (typeof data[project] === "string" || !owner) return data[project];
  const id = data[owner.id];
  return typeof id === "string" ? lookups.owners[owner.table].get(id) : null;
}

/**
 * The project the task left after this row was written, or undefined when it
 * has not moved since: the row belongs to the project it is in now, which the
 * reader can see or they would not be reading it. Two writes in the same
 * millisecond count as before the move.
 */
function projectLeftAfter(row: RedactableRow, lookups: Lookups): unknown {
  const move = lookups.moves
    .get(row.taskId)
    ?.find(({ at }) => at.getTime() >= row.createdAt.getTime());
  return move ? (move.from ?? null) : undefined;
}

function isHidden(
  projectId: unknown,
  details: readonly unknown[],
  canName: (projectId: string) => boolean,
): boolean {
  if (typeof projectId === "string") return !canName(projectId);
  return details.some((value) => value !== null && value !== undefined);
}

function blanked(
  data: Data,
  fields: readonly string[],
  hiddenFlag: string,
): Data {
  return {
    ...data,
    ...Object.fromEntries(fields.map((field) => [field, null])),
    [hiddenFlag]: true,
  };
}

/**
 * The event data as a reader sees it: every snapshot `canName` refuses is
 * blanked and flagged, and everything else is left as it is.
 */
function redactEventData(
  row: RedactableRow,
  lookups: Lookups,
  canName: (projectId: string) => boolean,
): unknown {
  const { type, eventData } = row;
  if (!isData(eventData)) return eventData;
  let data = eventData;
  for (const reference of REFERENCES[type] ?? []) {
    const { project, details, hiddenFlag } = reference;
    const projectId = referencedProject(reference, eventData, lookups);
    const values = details.map((field) => eventData[field]);
    if (isHidden(projectId, values, canName)) {
      data = blanked(data, [project, ...details], hiddenFlag);
    }
  }
  if (type === "parent_changed") {
    for (const field of PARENT_FIELDS) {
      const parent = eventData[field];
      if (!isData(parent)) continue;
      const values = [parent.id, parent.key, parent.title];
      if (isHidden(parent.projectId, values, canName)) {
        data = { ...data, [field]: HIDDEN_PARENT };
      }
    }
  }
  if (describesItsProject(type, eventData)) {
    const left = projectLeftAfter(row, lookups);
    if (left !== undefined && (typeof left !== "string" || !canName(left))) {
      const written = WRITTEN_IN_PROJECT[type];
      if (written) data = blanked(data, written.details, written.hiddenFlag);
      if (ruleNameOf(eventData)) {
        data = {
          ...data,
          automation: {
            ...(eventData.automation as Data),
            ruleId: null,
            ruleName: null,
            hidden: true,
          },
        };
      }
    }
  }
  return data;
}

async function loadOwners(table: OwnerTable, ids: ReadonlySet<string>) {
  if (ids.size === 0) return new Map<string, string>();
  const source = table === "cycle" ? cycleTable : moduleTable;
  const rows = await db
    .select({ id: source.id, projectId: source.projectId })
    .from(source)
    .where(inArray(source.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.projectId]));
}

async function loadMoves(taskIds: ReadonlySet<string>) {
  const moves = new Map<string, { at: Date; from: unknown }[]>();
  if (taskIds.size === 0) return moves;
  const rows = await db
    .select({
      taskId: activityTable.taskId,
      at: activityTable.createdAt,
      eventData: activityTable.eventData,
    })
    .from(activityTable)
    .where(
      and(
        inArray(activityTable.taskId, [...taskIds]),
        eq(activityTable.type, "moved"),
      ),
    )
    .orderBy(asc(activityTable.createdAt));
  for (const { taskId, at, eventData } of rows) {
    const from = isData(eventData) ? eventData.fromProjectId : null;
    moves.set(taskId, [...(moves.get(taskId) ?? []), { at, from }]);
  }
  return moves;
}

/** What the rows need looked up, in at most three queries. */
async function loadLookups(rows: readonly RedactableRow[]): Promise<Lookups> {
  const ownerIds: Record<OwnerTable, Set<string>> = {
    cycle: new Set(),
    module: new Set(),
  };
  const movableTasks = new Set<string>();
  for (const { taskId, type, eventData } of rows) {
    if (!isData(eventData)) continue;
    for (const { project, owner } of REFERENCES[type] ?? []) {
      const id = owner ? eventData[owner.id] : null;
      if (owner && typeof id === "string" && !eventData[project]) {
        ownerIds[owner.table].add(id);
      }
    }
    if (describesItsProject(type, eventData)) movableTasks.add(taskId);
  }
  const [cycle, module, moves] = await Promise.all([
    loadOwners("cycle", ownerIds.cycle),
    loadOwners("module", ownerIds.module),
    loadMoves(movableTasks),
  ]);
  return { owners: { cycle, module }, moves };
}

function projectsNamedBy(row: RedactableRow, lookups: Lookups): unknown[] {
  const { type, eventData } = row;
  if (!isData(eventData)) return [];
  const named: unknown[] = (REFERENCES[type] ?? []).map((reference) =>
    referencedProject(reference, eventData, lookups),
  );
  if (type === "parent_changed") {
    for (const field of PARENT_FIELDS) {
      const parent = eventData[field];
      if (isData(parent)) named.push(parent.projectId);
    }
  }
  if (describesItsProject(type, eventData)) {
    named.push(projectLeftAfter(row, lookups));
  }
  return named;
}

/** Redacts rows by the caller's own answer to which projects it may name. */
export async function redactActivityRowsBy<T extends RedactableRow>(
  rows: readonly T[],
  canName: (projectId: string) => boolean,
): Promise<T[]> {
  const lookups = await loadLookups(rows);
  return rows.map((row) => ({
    ...row,
    eventData: redactEventData(row, lookups, canName),
  }));
}

/** Redacts rows for a reader who can't see `hidden`. */
export async function redactActivityRows<T extends RedactableRow>(
  rows: readonly T[],
  reach: { workspaceIds: readonly string[]; hidden: readonly string[] },
): Promise<T[]> {
  const lookups = await loadLookups(rows);
  const named = [
    ...new Set(
      rows
        .flatMap((row) => projectsNamedBy(row, lookups))
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const reachable =
    named.length === 0
      ? []
      : await db
          .select({ id: projectTable.id })
          .from(projectTable)
          .where(
            and(
              inArray(projectTable.id, named),
              inArray(projectTable.workspaceId, [...reach.workspaceIds]),
              notHiddenProject(projectTable.id, reach.hidden),
            ),
          );
  const visible = new Set(reachable.map((project) => project.id));
  return rows.map((row) => ({
    ...row,
    eventData: redactEventData(row, lookups, (id) => visible.has(id)),
  }));
}

/**
 * The stored event data minus the snapshots a reader can't see, for matching
 * in SQL: text they can't read must not make a row match either. Needs
 * `activity` and the `project` of its task in the query. The names come from
 * the constants above, so raw SQL is safe here. Kept in step with
 * `redactEventData` by sharing its tables.
 */
export function readableEventDataSql(hidden: readonly string[]): SQL {
  const data = sql`${activityTable.eventData}`;
  const hiddenIds = sql`${sql.param([...hidden])}::text[]`;
  const quoted = (name: string) => sql.raw(`'${name}'`);
  const dropUnlessReachable = (projectId: SQL, fields: readonly string[]) => {
    const list = fields.map((field) => `'${field}'`).join(", ");
    return sql`(case when exists (
      select 1 from project as referenced_project
      where referenced_project.id = ${projectId}
        and referenced_project.workspace_id = ${projectTable.workspaceId}
        and referenced_project.id <> all(${hiddenIds})
    ) then '{}'::text[] else ${sql.raw(`array[${list}]::text[]`)} end)`;
  };
  const without = (drops: SQL[]) => sql.join([data, ...drops], sql` - `);
  const projectOf = ({ project, owner }: Reference) => {
    const stored = sql`${data}->>${quoted(project)}`;
    if (!owner) return stored;
    return sql`coalesce(${stored}, (
      select referenced_owner.project_id from ${sql.raw(`"${owner.table}"`)} as referenced_owner
      where referenced_owner.id = ${data}->>${quoted(owner.id)}
    ))`;
  };
  const arms = Object.entries(REFERENCES).map(
    ([type, references]) =>
      sql`when ${quoted(type)} then ${without(
        references.map((reference) =>
          dropUnlessReachable(projectOf(reference), [
            reference.project,
            ...reference.details,
          ]),
        ),
      )}`,
  );
  const parentArm = sql`when 'parent_changed' then ${without(
    PARENT_FIELDS.map((field) =>
      dropUnlessReachable(sql`${data}->${quoted(field)}->>'projectId'`, [
        field,
      ]),
    ),
  )}`;

  // The project the task left after the row was written, else its own. One
  // index probe per row, so only for a reader with something hidden: without
  // that the only difference is a slug of a purged project.
  const writtenIn = sql`coalesce((
    select coalesce(moved.event_data->>'fromProjectId', '')
    from activity as moved
    where moved.task_id = ${activityTable.taskId}
      and moved.type = 'moved'
      and moved.created_at >= ${activityTable.createdAt}
    order by moved.created_at
    limit 1
  ), ${projectTable.id})`;
  const writtenArms =
    hidden.length === 0
      ? []
      : Object.entries(WRITTEN_IN_PROJECT).map(
          ([type, { details }]) =>
            sql`when ${quoted(type)} then ${without([
              dropUnlessReachable(writtenIn, details),
            ])}`,
        );
  const body = sql`case ${activityTable.type} ${sql.join(
    [...arms, parentArm, ...writtenArms],
    sql` `,
  )} else ${data} end`;
  const readable =
    hidden.length === 0
      ? body
      : sql`(${body}) - (case when ${data}->'automation'->>'ruleName' is null
          then '{}'::text[]
          else ${dropUnlessReachable(writtenIn, ["automation"])} end)`;
  // `-` fails on a JSON scalar, which one odd row must not turn into a 500.
  return sql`case when jsonb_typeof(${data}) = 'object' then ${readable} else ${data} end`;
}
