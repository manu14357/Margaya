import { and, eq, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import db from "../database";
import {
  notificationTable,
  projectTable,
  taskSubscriberTable,
  taskTable,
  userNotificationPreferenceTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { deliverNotification } from "../notification-preferences/delivery";
import { assigneeIdsOfTasks } from "../task/assignees";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { safeOutboundError } from "../utils/outbound-request";
import { notificationCreatedEvent } from "./created-event";
import {
  buildCandidates,
  type Candidate,
  preferenceKeyForType,
  type RecipientReason,
  TASK_EVENT_POLICY,
  type TaskEventKind,
} from "./recipient-policy";

// The only code that decides who receives a task-event notification (B10
// K4). Every task path calls notifyTaskEvent; the reminder scheduler shares
// the "muted" rule through notMutedSql. Resolution runs a fixed number of
// statements whatever the audience size, and the writer inserts every row
// in one statement before handing each to the unchanged delivery code.

export type TaskEventInput = {
  taskId: string;
  kind: TaskEventKind;
  /** Who caused it; null for system or integration changes. */
  actorId?: string | null;
  /** Kind `mention`: the newly mentioned users. */
  mentionedIds?: readonly string[];
  /**
   * Kind `assigned`: the added users. Watcher kinds: extra people to reach
   * besides the watchers (a reply's thread participants).
   */
  directIds?: readonly string[];
  /** Users who must not get this one (already notified otherwise). */
  excludeIds?: readonly string[];
};

export type TaskEventContext = {
  taskId: string;
  taskTitle: string;
  taskKey: string;
  projectId: string;
  workspaceId: string;
  actorName: string | null;
};

export type ResolvedRecipients = {
  context: TaskEventContext;
  recipients: { userId: string; reason: RecipientReason }[];
};

const actorUser = alias(userTable, "notification_actor");

async function loadTaskContext(
  taskId: string,
  actorId: string | null,
): Promise<TaskEventContext | null> {
  const [row] = await db
    .select({
      taskTitle: taskTable.title,
      number: taskTable.number,
      projectId: projectTable.id,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      actorName: actorUser.name,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(actorUser, eq(actorUser.id, actorId ?? sql`null`))
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!row) return null;
  return {
    taskId,
    taskTitle: row.taskTitle,
    taskKey: formatTaskKey(row.slug, row.number),
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    actorName: actorId ? (row.actorName ?? null) : null,
  };
}

/**
 * Members of the workspace among `candidates` whose switch for `type` is
 * not off (a missing preference row means the defaults, all on).
 */
async function eligibleUserIds(
  workspaceId: string,
  candidates: readonly Candidate[],
  type: string,
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const key = preferenceKeyForType(type);
  const ids = candidates.map((candidate) => candidate.userId);
  const rows = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    // AI agents are members but never notified (they read no inbox).
    .innerJoin(
      userTable,
      and(
        eq(userTable.id, workspaceUserTable.userId),
        sql`${userTable.kind} <> 'agent'`,
      ),
    )
    .leftJoin(
      userNotificationPreferenceTable,
      eq(userNotificationPreferenceTable.userId, workspaceUserTable.userId),
    )
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        sql`${workspaceUserTable.userId} = any(${sql.param(ids)}::text[])`,
        key
          ? sql`${userNotificationPreferenceTable[key]} is not false`
          : undefined,
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/** Who receives this task event, with the task context (§3.2 steps 1–6). */
export async function resolveTaskEventRecipients(
  input: TaskEventInput,
): Promise<ResolvedRecipients | null> {
  const actorId = input.actorId || null;
  const context = await loadTaskContext(input.taskId, actorId);
  if (!context) return null;

  const assignees =
    (await assigneeIdsOfTasks([input.taskId])).get(input.taskId) ?? [];
  const subscriberRows = await db
    .select({
      userId: taskSubscriberTable.userId,
      subscribed: taskSubscriberTable.subscribed,
    })
    .from(taskSubscriberTable)
    .where(eq(taskSubscriberTable.taskId, input.taskId));

  const candidates = buildCandidates({
    kind: input.kind,
    assigneeIds: assignees,
    subscriberRows,
    mentionedIds: input.mentionedIds,
    directIds: input.directIds,
    actorId,
    excludeIds: input.excludeIds,
  });
  const eligible = await eligibleUserIds(
    context.workspaceId,
    candidates,
    TASK_EVENT_POLICY[input.kind].type,
  );

  return {
    context,
    recipients: candidates.filter((candidate) =>
      eligible.has(candidate.userId),
    ),
  };
}

type NotificationRow = typeof notificationTable.$inferSelect;

/**
 * Inserts one row per recipient in one statement, then publishes
 * `notification.created` and schedules external delivery for each row,
 * exactly as createNotification does for one.
 */
export async function writeTaskNotifications(input: {
  userIds: readonly string[];
  type: string;
  taskId: string;
  workspaceId: string;
  actorId: string | null;
  eventData: Record<string, unknown>;
  /** Stored English text, used by external delivery when set. */
  title?: string;
  content?: string;
}): Promise<NotificationRow[]> {
  if (input.userIds.length === 0) return [];
  const rows = await db
    .insert(notificationTable)
    .values(
      input.userIds.map((userId) => ({
        userId,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        type: input.type,
        title: input.title ?? null,
        content: input.content ?? null,
        eventData: input.eventData,
        resourceId: input.taskId,
        resourceType: "task",
      })),
    )
    .returning();

  for (const row of rows) {
    await publishEvent("notification.created", notificationCreatedEvent(row));
    void deliverNotification(row.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: row.id,
        error: safeOutboundError(error),
      });
    });
  }
  return rows;
}

/**
 * Resolve plus write: the one entry point every task notification path
 * uses. `eventData` adds the kind's fields to the standard ones (task
 * title, key, project, workspace and the actor's name). Returns the rows.
 */
export async function notifyTaskEvent(
  input: TaskEventInput & {
    eventData?: Record<string, unknown>;
    title?: string;
    content?: string;
  },
): Promise<NotificationRow[]> {
  const resolved = await resolveTaskEventRecipients(input);
  if (!resolved || resolved.recipients.length === 0) return [];
  const { context } = resolved;
  // Older clients and external delivery read these per-type name fields.
  const legacyName =
    input.kind === "mention"
      ? { mentionerName: context.actorName }
      : input.kind === "comment"
        ? { commenterName: context.actorName }
        : {};
  return writeTaskNotifications({
    userIds: resolved.recipients.map((recipient) => recipient.userId),
    type: TASK_EVENT_POLICY[input.kind].type,
    taskId: context.taskId,
    workspaceId: context.workspaceId,
    actorId: input.actorId || null,
    title: input.title,
    content: input.content,
    eventData: {
      taskTitle: context.taskTitle,
      taskKey: context.taskKey,
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      ...(context.actorName ? { actorName: context.actorName } : {}),
      ...legacyName,
      ...input.eventData,
    },
  });
}

const MUTED_ALIAS = "task_subscriber_muted";
const mutedRow = alias(taskSubscriberTable, MUTED_ALIAS);

/**
 * True unless the user explicitly unsubscribed from the task (a muted
 * row). Correlated to the given task id and user id expressions.
 */
export function notMutedSql(
  taskId: SQLWrapper,
  userId: SQLWrapper,
): SQL<boolean> {
  return sql<boolean>`not exists (
    select 1 from ${taskSubscriberTable} as ${sql.identifier(MUTED_ALIAS)}
    where ${mutedRow.taskId} = ${taskId}
      and ${mutedRow.userId} = ${userId}
      and ${mutedRow.subscribed} = false
  )`;
}
