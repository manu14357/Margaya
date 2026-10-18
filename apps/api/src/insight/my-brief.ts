import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import {
  activityTable,
  columnTable,
  notificationTable,
  pageTable,
  projectTable,
  taskAssigneeTable,
  taskRelationTable,
  taskSubscriberTable,
  taskTable,
  userTable,
} from "../database/schema";
import { notificationResourceAccess } from "../notification/resource-access";
import { projectVisibleSql } from "../project/visibility";
import { taskAssigneeJoin } from "../task/assignees";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { getUserTimezone } from "../utils/timezone";
import {
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  todayInTimezone,
} from "../utils/zoned-date";
import { taskKey } from "./shared";

// "My brief" (#18): one person's short daily note, computed from their own
// visible data in one workspace: what is due today or overdue, new
// mentions, their blocked tasks, and what changed on tasks they follow.
// Deterministic; the optional AI summary (insight/ai.ts) only retells it.

/** Changes are counted over the last day. */
export const MY_BRIEF_WINDOW_HOURS = 24;
/** Unread mentions are read back this far. */
export const MY_BRIEF_MENTION_DAYS = 7;
/** Rows listed per section; totals count all. */
export const MY_BRIEF_LIST_LIMIT = 10;
const ROW_LIMIT = 200;

const HOUR_MS = 3_600_000;
const OPEN = sql`${taskGroupSql} in ('backlog', 'unstarted', 'started')`;
const MENTION_TYPES = ["task_mention", "page_mention"];

export type MyBriefTask = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  dueDate: string | null;
};

export type MyBriefChangeKind =
  | "status"
  | "comment"
  | "assignee"
  | "priority"
  | "due_date"
  | "other";

function changeKind(type: string): MyBriefChangeKind {
  if (type === "status_changed") return "status";
  if (type === "comment") return "comment";
  if (type === "assignee_changed" || type === "unassigned") return "assignee";
  if (type === "priority_changed") return "priority";
  if (type === "due_date_changed") return "due_date";
  return "other";
}

const taskColumns = {
  id: taskTable.id,
  number: taskTable.number,
  title: taskTable.title,
  projectId: taskTable.projectId,
  projectName: projectTable.name,
  slug: projectTable.slug,
  dueDate: taskTable.dueDate,
};

type TaskRow = {
  id: string;
  number: number | null;
  title: string;
  projectId: string;
  projectName: string;
  slug: string;
  dueDate: Date | null;
};

const toTask = (row: TaskRow): MyBriefTask => ({
  id: row.id,
  key: taskKey(row.slug, row.number),
  title: row.title,
  projectId: row.projectId,
  projectName: row.projectName,
  dueDate: row.dueDate ? row.dueDate.toISOString() : null,
});

/** The person's open assigned tasks in the workspace's visible projects. */
function myOpenTasks(userId: string, workspaceId: string) {
  return and(
    eq(projectTable.workspaceId, workspaceId),
    isNull(projectTable.deletedAt),
    projectVisibleSql(projectTable.id, userId),
    visibleTaskCondition,
    OPEN,
  );
}

async function dueTasks(
  userId: string,
  workspaceId: string,
  todayStart: Date,
  tomorrowStart: Date,
) {
  const rows = await db
    .select(taskColumns)
    .from(taskTable)
    .innerJoin(
      taskAssigneeTable,
      and(taskAssigneeJoin, eq(taskAssigneeTable.userId, userId)),
    )
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        myOpenTasks(userId, workspaceId),
        isNotNull(taskTable.dueDate),
        lt(taskTable.dueDate, tomorrowStart),
      ),
    )
    .orderBy(asc(taskTable.dueDate), asc(taskTable.id))
    .limit(ROW_LIMIT);
  const overdue = rows.filter((row) => row.dueDate && row.dueDate < todayStart);
  const today = rows.filter((row) => row.dueDate && row.dueDate >= todayStart);
  return { overdue: overdue.map(toTask), today: today.map(toTask) };
}

async function mentions(userId: string, workspaceId: string, since: Date) {
  const rows = await db
    .select({
      id: notificationTable.id,
      type: notificationTable.type,
      createdAt: notificationTable.createdAt,
      resourceId: notificationTable.resourceId,
      resourceType: notificationTable.resourceType,
      actorName: userTable.name,
      taskTitle: taskTable.title,
      taskNumber: taskTable.number,
      taskProjectId: taskTable.projectId,
      slug: projectTable.slug,
      pageTitle: pageTable.title,
      pageProjectId: pageTable.projectId,
    })
    .from(notificationTable)
    .leftJoin(userTable, eq(userTable.id, notificationTable.actorId))
    .leftJoin(
      taskTable,
      and(
        eq(notificationTable.resourceType, "task"),
        eq(taskTable.id, notificationTable.resourceId),
      ),
    )
    .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(
      pageTable,
      and(
        eq(notificationTable.resourceType, "page"),
        eq(pageTable.id, notificationTable.resourceId),
      ),
    )
    .where(
      and(
        eq(notificationTable.userId, userId),
        eq(notificationTable.workspaceId, workspaceId),
        inArray(notificationTable.type, MENTION_TYPES),
        sql`${notificationTable.isRead} is not true`,
        isNull(notificationTable.archivedAt),
        gt(notificationTable.createdAt, since),
        notificationResourceAccess(
          userId,
          notificationTable.resourceId,
          notificationTable.resourceType,
        ),
      ),
    )
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id))
    .limit(ROW_LIMIT);
  return rows.map((row) => {
    const isTask = row.resourceType === "task" && row.taskTitle !== null;
    return {
      id: row.id,
      kind: isTask ? ("task" as const) : ("page" as const),
      actorName: row.actorName,
      taskId: isTask ? row.resourceId : null,
      pageId: !isTask && row.resourceType === "page" ? row.resourceId : null,
      projectId: isTask ? row.taskProjectId : row.pageProjectId,
      key: isTask && row.slug ? taskKey(row.slug, row.taskNumber) : null,
      title: (isTask ? row.taskTitle : row.pageTitle) ?? "",
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** My open tasks that wait on an open blocker. */
async function blockedTasks(userId: string, workspaceId: string) {
  const blocker = alias(taskTable, "blocker");
  const blockerProject = alias(projectTable, "blocker_project");
  const blockerColumn = alias(columnTable, "blocker_column");
  const rows = await db
    .select({
      ...taskColumns,
      blockerId: blocker.id,
      blockerNumber: blocker.number,
      blockerTitle: blocker.title,
      blockerSlug: blockerProject.slug,
      blockerVisible: projectVisibleSql(blockerProject.id, userId),
    })
    .from(taskTable)
    .innerJoin(
      taskAssigneeTable,
      and(taskAssigneeJoin, eq(taskAssigneeTable.userId, userId)),
    )
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .innerJoin(
      taskRelationTable,
      and(
        eq(taskRelationTable.targetTaskId, taskTable.id),
        eq(taskRelationTable.relationType, "blocks"),
      ),
    )
    .innerJoin(blocker, eq(blocker.id, taskRelationTable.sourceTaskId))
    .innerJoin(blockerProject, eq(blockerProject.id, blocker.projectId))
    .leftJoin(blockerColumn, eq(blockerColumn.id, blocker.columnId))
    .where(
      and(
        myOpenTasks(userId, workspaceId),
        isNull(blocker.deletedAt),
        isNull(blocker.archivedAt),
        isNull(blocker.completedAt),
        isNull(blockerProject.deletedAt),
        sql`coalesce(${blockerColumn.group}, '') not in ('completed', 'cancelled')`,
      ),
    )
    .orderBy(asc(taskTable.dueDate), asc(taskTable.id))
    .limit(ROW_LIMIT);
  const byTask = new Map<
    string,
    {
      task: MyBriefTask;
      blockers: Array<{ id: string; key: string; title: string }>;
      hiddenBlockers: number;
    }
  >();
  for (const row of rows) {
    const entry = byTask.get(row.id) ?? {
      task: toTask(row),
      blockers: [],
      hiddenBlockers: 0,
    };
    if (row.blockerVisible) {
      entry.blockers.push({
        id: row.blockerId,
        key: taskKey(row.blockerSlug, row.blockerNumber),
        title: row.blockerTitle,
      });
    } else {
      entry.hiddenBlockers += 1;
    }
    byTask.set(row.id, entry);
  }
  return [...byTask.values()];
}

/**
 * Changes by other people since `since` on tasks the person follows: tasks
 * they watch, plus their assigned tasks unless they muted them.
 */
async function followedChanges(
  userId: string,
  workspaceId: string,
  since: Date,
) {
  const watched = sql`(exists (
      select 1 from ${taskSubscriberTable} ts
      where ts.task_id = ${taskTable.id} and ts.user_id = ${userId} and ts.subscribed
    ) or (exists (
      select 1 from ${taskAssigneeTable} ta
      where ta.task_id = ${taskTable.id} and ta.user_id = ${userId}
    ) and not exists (
      select 1 from ${taskSubscriberTable} tm
      where tm.task_id = ${taskTable.id} and tm.user_id = ${userId} and not tm.subscribed
    )))`;
  const rows = await db
    .select({
      ...taskColumns,
      type: activityTable.type,
      at: activityTable.createdAt,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        projectVisibleSql(projectTable.id, userId),
        visibleTaskCondition,
        gte(activityTable.createdAt, since),
        or(isNull(activityTable.userId), ne(activityTable.userId, userId)),
        watched,
      ),
    )
    .orderBy(desc(activityTable.createdAt))
    .limit(ROW_LIMIT * 5);
  const byTask = new Map<
    string,
    {
      task: MyBriefTask;
      changes: number;
      kinds: MyBriefChangeKind[];
      lastAt: string;
    }
  >();
  for (const row of rows) {
    const entry = byTask.get(row.id) ?? {
      task: toTask(row),
      changes: 0,
      kinds: [],
      lastAt: row.at.toISOString(),
    };
    entry.changes += 1;
    const kind = changeKind(row.type);
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
    byTask.set(row.id, entry);
  }
  return [...byTask.values()];
}

const limited = <T>(list: T[]) => ({
  total: list.length,
  items: list.slice(0, MY_BRIEF_LIST_LIMIT),
});

export type MyBrief = Awaited<ReturnType<typeof computeMyBrief>>;

/** GET /insight/my-brief */
export async function computeMyBrief(input: {
  userId: string;
  workspaceId: string;
  now?: Date;
  timeZone?: string;
  /** Count changes from here instead of the last 24 hours (digests). */
  since?: Date;
}) {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? (await getUserTimezone(input.userId));
  const today = todayInTimezone(timeZone, now);
  const todayStart = startOfLocalDayUtc(today, timeZone);
  const tomorrowStart = startOfNextLocalDayUtc(today, timeZone);
  const since =
    input.since ?? new Date(now.getTime() - MY_BRIEF_WINDOW_HOURS * HOUR_MS);
  const mentionSince = new Date(
    now.getTime() - MY_BRIEF_MENTION_DAYS * 24 * HOUR_MS,
  );
  const [due, mentionRows, blocked, following] = await Promise.all([
    dueTasks(input.userId, input.workspaceId, todayStart, tomorrowStart),
    mentions(input.userId, input.workspaceId, mentionSince),
    blockedTasks(input.userId, input.workspaceId),
    followedChanges(input.userId, input.workspaceId, since),
  ]);
  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    today,
    timeZone,
    dueToday: limited(due.today),
    overdue: limited(due.overdue),
    mentions: limited(mentionRows),
    blocked: limited(blocked),
    following: limited(following),
  };
}

/** True when the brief has nothing to say. */
export function isMyBriefEmpty(brief: MyBrief): boolean {
  return (
    brief.dueToday.total === 0 &&
    brief.overdue.total === 0 &&
    brief.mentions.total === 0 &&
    brief.blocked.total === 0 &&
    brief.following.total === 0
  );
}
