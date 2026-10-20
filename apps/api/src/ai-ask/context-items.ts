import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AiScope } from "../ai/context";
import { loadPageContext, projectDataTier } from "../ai/context";
import { OPEN_COLUMN_GROUPS } from "../column/groups";
import db from "../database";
import {
  agentTable,
  columnTable,
  cycleTable,
  cycleTaskTable,
  moduleTable,
  moduleTaskTable,
  projectTable,
  taskAssigneeTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { factsItem, loadAskFacts } from "./facts";
import {
  type AskItem,
  loadTasks,
  refText,
  taskItem,
  workspaceTimeZone,
} from "./retrieve";
import type { AskContextRef } from "./schema";
import { formatTrend, loadCycleBurn } from "./trend";

// "@" context for Ask: items the person pointed at, loaded fresh with the
// same checks as retrieval and put first. Anything unknown, of another
// workspace, invisible to the caller or in a project AI may not read is
// skipped without a word, like a search that found nothing.

/** Tasks listed for one cycle, module, person or agent. */
export const MAX_CONTEXT_TASKS = 25;

type Load = {
  scope: AiScope;
  refs: readonly AskContextRef[];
  now: Date;
  /** The question asks about change over time: add a cycle's burn-up. */
  trend: boolean;
};

const openSql = sql`${taskGroupSql} in (${sql.join(
  OPEN_COLUMN_GROUPS.map((group) => sql`${group}`),
  sql`, `,
)})`;

function factsBlock(
  scope: AiScope,
  id: string,
  projectId: string | null,
  label: string,
  text: string,
): AskItem {
  return {
    kind: "project",
    id: `context:${id}`,
    projectId,
    title: label,
    url: "",
    source: `facts:${refText(label)}`,
    author: null,
    text,
    dataTier: projectId ? projectDataTier(scope, projectId) : "private",
    ref: null,
    updatedAt: null,
  };
}

async function taskItems(
  scope: AiScope,
  ids: string[],
  today: string,
  describe: boolean,
): Promise<AskItem[]> {
  const tasks = await loadTasks(scope, ids);
  return ids.flatMap((id) => {
    const task = tasks.get(id);
    return task
      ? [
          taskItem(
            scope,
            task,
            today,
            { blockedBy: [], blocks: [] },
            { describe },
          ),
        ]
      : [];
  });
}

/** Group counts of a set of task rows (visible tasks only). */
async function groupCounts(
  scope: AiScope,
  where: ReturnType<typeof and>,
  join: "cycle" | "module",
) {
  const base = db
    .select({
      total: sql<number>`count(*)::int`.mapWith(Number),
      open: sql<number>`(count(*) filter (where ${openSql}))::int`.mapWith(
        Number,
      ),
      completed:
        sql<number>`(count(*) filter (where ${taskGroupSql} = 'completed'))::int`.mapWith(
          Number,
        ),
      cancelled:
        sql<number>`(count(*) filter (where ${taskGroupSql} = 'cancelled'))::int`.mapWith(
          Number,
        ),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin);
  const joined =
    join === "cycle"
      ? base.innerJoin(cycleTaskTable, eq(cycleTaskTable.taskId, taskTable.id))
      : base.innerJoin(
          moduleTaskTable,
          eq(moduleTaskTable.taskId, taskTable.id),
        );
  const [row] = await joined.where(
    and(
      where,
      eq(projectTable.workspaceId, scope.workspaceId),
      visibleTaskCondition,
    ),
  );
  return row ?? { total: 0, open: 0, completed: 0, cancelled: 0 };
}

async function cycleItems(input: Load, id: string, today: string) {
  const { scope } = input;
  const [cycle] = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      projectId: cycleTable.projectId,
      startDate: cycleTable.startDate,
      endDate: cycleTable.endDate,
      cyclesEnabled: projectTable.cyclesEnabled,
      workspaceId: projectTable.workspaceId,
    })
    .from(cycleTable)
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .where(and(eq(cycleTable.id, id), isNull(projectTable.deletedAt)))
    .limit(1);
  if (
    !cycle ||
    cycle.workspaceId !== scope.workspaceId ||
    !cycle.cyclesEnabled ||
    !scope.projectIds.has(cycle.projectId)
  ) {
    return [];
  }
  const where = and(
    eq(cycleTaskTable.cycleId, cycle.id),
    eq(taskTable.projectId, cycle.projectId),
  );
  const [counts, rows] = await Promise.all([
    groupCounts(scope, where, "cycle"),
    db
      .select({ id: taskTable.id })
      .from(cycleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(and(where, visibleTaskCondition))
      .orderBy(desc(openSql), desc(taskTable.updatedAt))
      .limit(MAX_CONTEXT_TASKS),
  ]);
  const timeZone = input.trend
    ? await workspaceTimeZone(scope.workspaceId)
    : "";
  const burn = input.trend
    ? await loadCycleBurn({ scope, cycle, now: input.now, timeZone })
    : null;
  const lines = [
    `Cycle "${cycle.name}" (${cycle.startDate ?? "no start date"} to ${cycle.endDate ?? "no end date"}): ${counts.total} task(s), ${counts.open} open, ${counts.completed} completed, ${counts.cancelled} cancelled.${counts.total > rows.length ? ` The ${rows.length} listed below are a sample.` : ""}`,
    ...(burn
      ? [
          formatTrend({
            unit: "day",
            scopeLabel: "",
            timeZone,
            buckets: [],
            burn,
          }),
        ]
      : []),
  ];
  return [
    factsBlock(
      scope,
      cycle.id,
      cycle.projectId,
      `cycle ${cycle.name}`,
      lines.join("\n"),
    ),
    ...(await taskItems(
      scope,
      rows.map((row) => row.id),
      today,
      false,
    )),
  ];
}

async function moduleItems(input: Load, id: string, today: string) {
  const { scope } = input;
  const [module] = await db
    .select({
      id: moduleTable.id,
      name: moduleTable.name,
      projectId: moduleTable.projectId,
      startDate: moduleTable.startDate,
      targetDate: moduleTable.targetDate,
      archivedAt: moduleTable.archivedAt,
      modulesEnabled: projectTable.modulesEnabled,
      workspaceId: projectTable.workspaceId,
    })
    .from(moduleTable)
    .innerJoin(projectTable, eq(projectTable.id, moduleTable.projectId))
    .where(and(eq(moduleTable.id, id), isNull(projectTable.deletedAt)))
    .limit(1);
  if (
    !module ||
    module.archivedAt ||
    module.workspaceId !== scope.workspaceId ||
    !module.modulesEnabled ||
    !scope.projectIds.has(module.projectId)
  ) {
    return [];
  }
  const where = and(
    eq(moduleTaskTable.moduleId, module.id),
    eq(taskTable.projectId, module.projectId),
  );
  const [counts, rows] = await Promise.all([
    groupCounts(scope, where, "module"),
    db
      .select({ id: taskTable.id })
      .from(moduleTaskTable)
      .innerJoin(taskTable, eq(taskTable.id, moduleTaskTable.taskId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(and(where, visibleTaskCondition))
      .orderBy(desc(openSql), desc(taskTable.updatedAt))
      .limit(MAX_CONTEXT_TASKS),
  ]);
  const text = `Module "${module.name}" (${module.startDate ?? "no start date"} to ${module.targetDate ?? "no target date"}): ${counts.total} task(s), ${counts.open} open, ${counts.completed} completed, ${counts.cancelled} cancelled.${counts.total > rows.length ? ` The ${rows.length} listed below are a sample.` : ""}`;
  return [
    factsBlock(
      scope,
      module.id,
      module.projectId,
      `module ${module.name}`,
      text,
    ),
    ...(await taskItems(
      scope,
      rows.map((row) => row.id),
      today,
      false,
    )),
  ];
}

async function personItems(
  input: Load,
  ref: AskContextRef,
  today: string,
): Promise<AskItem[]> {
  const { scope } = input;
  let userId = ref.id;
  if (ref.kind === "agent") {
    const [agent] = await db
      .select({ userId: agentTable.userId })
      .from(agentTable)
      .where(
        and(
          eq(agentTable.id, ref.id),
          eq(agentTable.workspaceId, scope.workspaceId),
        ),
      )
      .limit(1);
    if (agent) userId = agent.userId;
  }
  const [member] = await db
    .select({ id: userTable.id, name: userTable.name, kind: userTable.kind })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, scope.workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  const projectIds = [...scope.projectIds];
  if (!member || projectIds.length === 0 || !scope.can.readTasks) return [];
  const where = and(
    eq(taskAssigneeTable.userId, member.id),
    inArray(taskTable.projectId, projectIds),
    eq(projectTable.workspaceId, scope.workspaceId),
    visibleTaskCondition,
    openSql,
  );
  const [[count], rows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
      .from(taskAssigneeTable)
      .innerJoin(taskTable, eq(taskTable.id, taskAssigneeTable.taskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(where),
    db
      .select({ id: taskTable.id })
      .from(taskAssigneeTable)
      .innerJoin(taskTable, eq(taskTable.id, taskAssigneeTable.taskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .leftJoin(columnTable, taskColumnJoin)
      .where(where)
      .orderBy(
        sql`${taskTable.dueDate} asc nulls last`,
        desc(taskTable.updatedAt),
      )
      .limit(MAX_CONTEXT_TASKS),
  ]);
  const total = count?.total ?? 0;
  const who = member.kind === "agent" ? "agent" : "person";
  const text = `Open tasks assigned to ${member.name} (${who}): ${total}.${total > rows.length ? ` The ${rows.length} listed below come first by due date.` : ""}`;
  return [
    factsBlock(scope, member.id, null, member.name, text),
    ...(await taskItems(
      scope,
      rows.map((row) => row.id),
      today,
      false,
    )),
  ];
}

async function projectItems(input: Load, id: string): Promise<AskItem[]> {
  const { scope } = input;
  if (!scope.projectIds.has(id)) return [];
  const [project] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      description: projectTable.description,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
    })
    .from(projectTable)
    .where(and(eq(projectTable.id, id), isNull(projectTable.deletedAt)))
    .limit(1);
  if (!project) return [];
  const items: AskItem[] = [
    {
      kind: "project",
      id: project.id,
      projectId: project.id,
      title: project.name,
      url: `/dashboard/workspace/${scope.workspaceId}/project/${project.id}/board`,
      source: `project:${project.slug.toUpperCase()}`,
      author: null,
      text: [`Project: ${project.name}`, project.description ?? ""]
        .filter(Boolean)
        .join("\n"),
      dataTier: projectDataTier(scope, project.id),
      ref: null,
      updatedAt: null,
    },
  ];
  if (scope.can.readTasks) {
    const facts = await loadAskFacts({
      scope,
      projects: [project],
      now: input.now,
      timeZone: await workspaceTimeZone(scope.workspaceId),
    });
    if (facts) items.push(factsItem(scope, facts, [project.id]));
  }
  return items;
}

async function pageItem(scope: AiScope, id: string): Promise<AskItem[]> {
  try {
    const page = await loadPageContext(scope, id, { maxChars: 8_000 });
    const ref = `P:${refText(page.title) || "Untitled"}`;
    return [{ ...page, source: ref, ref, updatedAt: null }];
  } catch {
    // Missing, invisible, archived or AI may not read it: skipped.
    return [];
  }
}

/**
 * The items of the person's "@" mentions, in the order given. Tasks and
 * pages are citable; the rest are facts blocks plus the tasks they list.
 */
export async function loadAskContextRefs(input: Load): Promise<AskItem[]> {
  const today = input.now.toISOString().slice(0, 10);
  const seen = new Set<string>();
  const out: AskItem[] = [];
  const taskIds = input.refs
    .filter((ref) => ref.kind === "task")
    .map((ref) => ref.id);
  const tasks = input.scope.can.readTasks
    ? await taskItems(input.scope, taskIds, today, true)
    : [];
  const byTask = new Map(tasks.map((item) => [item.id, item]));
  for (const ref of input.refs) {
    let items: AskItem[] = [];
    if (ref.kind === "task") {
      const item = byTask.get(ref.id);
      items = item ? [item] : [];
    } else if (ref.kind === "page") {
      items = await pageItem(input.scope, ref.id);
    } else if (ref.kind === "project") {
      items = await projectItems(input, ref.id);
    } else if (ref.kind === "cycle") {
      items = await cycleItems(input, ref.id, today);
    } else if (ref.kind === "module") {
      items = await moduleItems(input, ref.id, today);
    } else {
      items = await personItems(input, ref, today);
    }
    for (const item of items) {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
