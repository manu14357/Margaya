import type {
  DigestBrief,
  DigestMention,
  DigestProjectUpdate,
  DigestTask,
  DigestWorkspace,
} from "@margaya/email";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import db from "../database";
import {
  columnTable,
  notificationTable,
  projectTable,
  projectUpdateSubscriberTable,
  projectUpdateTable,
  taskAssigneeTable,
  taskTable,
  userNotificationWorkspaceRuleTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { computeMyBrief } from "../insight/my-brief";
import { inboxViewCondition } from "../notification/inbox";
import { notificationResourceAccess } from "../notification/resource-access";
import {
  buildRecipientDeliveryContent,
  buildTaskUrl,
} from "../notification-preferences/delivery";
import { projectVisibleSql } from "../project/visibility";
import { taskAssigneeJoin } from "../task/assignees";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import { workspaceInboxUrl } from "./links";

// What a digest says, per workspace the user belongs to, limited to what
// they can see: open tasks assigned to them that are overdue or due within
// 7 days, mentions since the last digest, and how many inbox notifications
// arrived since then and are still unread.

const DUE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DUE_ROWS = 1000;
const MAX_DUE_LISTED = 10;
const MAX_MENTIONS_LISTED = 5;
const MAX_MENTION_ROWS = 500;
const MENTION_TYPES = ["task_mention", "page_mention"];

type DigestInput = {
  userId: string;
  since: Date;
  now: Date;
  timeZone: string;
  locale: string | null;
  /** Add My brief's blocked and followed tasks (opt-in, #18). */
  includeBrief?: boolean;
};

/**
 * The parts of My brief the digest does not already hold: blocked tasks
 * and changes on followed tasks. Computed, never written by a model.
 */
async function briefSection(
  userId: string,
  workspaceId: string,
  now: Date,
  since: Date,
  timeZone: string,
): Promise<DigestBrief | null> {
  const brief = await computeMyBrief({
    userId,
    workspaceId,
    now,
    since,
    timeZone,
  });
  if (brief.blocked.total === 0 && brief.following.total === 0) return null;
  return {
    blocked: brief.blocked.items.map((entry) => ({
      title: `${entry.task.key} ${entry.task.title}`,
      url: buildTaskUrl(workspaceId, entry.task.projectId, entry.task.id),
      projectName: entry.task.projectName,
      blockers: entry.blockers.map((blocker) => blocker.key),
      hiddenBlockers: entry.hiddenBlockers,
    })),
    moreBlocked: brief.blocked.total - brief.blocked.items.length,
    following: brief.following.items.map((entry) => ({
      title: `${entry.task.key} ${entry.task.title}`,
      url: buildTaskUrl(workspaceId, entry.task.projectId, entry.task.id),
      projectName: entry.task.projectName,
      changes: entry.changes,
    })),
    moreFollowing: brief.following.total - brief.following.items.length,
  };
}

/** Workspaces the user is in, minus those whose notifications they paused. */
async function digestWorkspacesOf(userId: string) {
  return db
    .select({ id: workspaceTable.id, name: workspaceTable.name })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .leftJoin(
      userNotificationWorkspaceRuleTable,
      and(
        eq(userNotificationWorkspaceRuleTable.userId, userId),
        eq(userNotificationWorkspaceRuleTable.workspaceId, workspaceTable.id),
      ),
    )
    .where(
      and(
        eq(workspaceUserTable.userId, userId),
        sql`${userNotificationWorkspaceRuleTable.isActive} is not false`,
      ),
    )
    .orderBy(asc(workspaceTable.name), asc(workspaceTable.id));
}

async function dueTasksOf(userId: string, workspaceIds: string[], now: Date) {
  return db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      dueDate: taskTable.dueDate,
      projectId: projectTable.id,
      projectName: projectTable.name,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(
      taskAssigneeTable,
      and(taskAssigneeJoin, eq(taskAssigneeTable.userId, userId)),
    )
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(projectTable.workspaceId, workspaceIds),
        isNull(projectTable.deletedAt),
        projectVisibleSql(projectTable.id, userId),
        visibleTaskCondition,
        sql`${taskGroupSql} not in ('completed', 'cancelled')`,
        isNotNull(taskTable.dueDate),
        lte(taskTable.dueDate, new Date(now.getTime() + DUE_HORIZON_MS)),
      ),
    )
    .orderBy(asc(taskTable.dueDate), asc(taskTable.id))
    .limit(MAX_DUE_ROWS);
}

async function mentionsOf(userId: string, workspaceIds: string[], since: Date) {
  return db
    .select({
      id: notificationTable.id,
      type: notificationTable.type,
      title: notificationTable.title,
      content: notificationTable.content,
      eventData: notificationTable.eventData,
      resourceId: notificationTable.resourceId,
      resourceType: notificationTable.resourceType,
      workspaceId: notificationTable.workspaceId,
    })
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        inArray(notificationTable.workspaceId, workspaceIds),
        inArray(notificationTable.type, MENTION_TYPES),
        gt(notificationTable.createdAt, since),
        notificationResourceAccess(
          userId,
          notificationTable.resourceId,
          notificationTable.resourceType,
        ),
      ),
    )
    .orderBy(desc(notificationTable.createdAt), desc(notificationTable.id))
    .limit(MAX_MENTION_ROWS);
}

const MAX_PROJECT_UPDATES_LISTED = 5;
const PROJECT_UPDATE_SUMMARY_CHARS = 160;

/**
 * Status updates posted since the last digest on projects the user follows
 * (a subscribed row, or the lead without a muted row) and can see. Following
 * is the opt-in: people who follow no project get no section.
 */
async function projectUpdatesOf(
  userId: string,
  workspaceIds: string[],
  since: Date,
) {
  return db
    .select({
      id: projectUpdateTable.id,
      projectId: projectUpdateTable.projectId,
      workspaceId: projectUpdateTable.workspaceId,
      projectName: projectTable.name,
      health: projectUpdateTable.health,
      summary: projectUpdateTable.summary,
    })
    .from(projectUpdateTable)
    .innerJoin(projectTable, eq(projectTable.id, projectUpdateTable.projectId))
    .leftJoin(
      projectUpdateSubscriberTable,
      and(
        eq(projectUpdateSubscriberTable.projectId, projectTable.id),
        eq(projectUpdateSubscriberTable.userId, userId),
      ),
    )
    .where(
      and(
        inArray(projectUpdateTable.workspaceId, workspaceIds),
        gt(projectUpdateTable.createdAt, since),
        sql`${projectUpdateTable.authorId} is distinct from ${userId}`,
        eq(projectTable.updatesEnabled, true),
        isNull(projectTable.deletedAt),
        projectVisibleSql(projectTable.id, userId),
        sql`coalesce(${projectUpdateSubscriberTable.subscribed}, ${projectTable.leadUserId} = ${userId}, false)`,
      ),
    )
    .orderBy(desc(projectUpdateTable.createdAt), desc(projectUpdateTable.id))
    .limit(MAX_PROJECT_UPDATES_LISTED * 10);
}

function projectUpdatesUrl(workspaceId: string, projectId: string) {
  const clientUrl = process.env.MARGAYA_CLIENT_URL || "http://localhost:5173";
  return `${clientUrl}/dashboard/workspace/${workspaceId}/project/${projectId}/updates`;
}

async function unreadCountsOf(
  userId: string,
  workspaceIds: string[],
  since: Date,
  now: Date,
) {
  const rows = await db
    .select({
      workspaceId: notificationTable.workspaceId,
      unread: sql<number>`count(*)`.mapWith(Number),
    })
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        inArray(notificationTable.workspaceId, workspaceIds),
        sql`${notificationTable.isRead} is not true`,
        inboxViewCondition("inbox", now),
        sql`coalesce(${notificationTable.resurfacedAt}, ${notificationTable.createdAt}) > ${since}`,
        notificationResourceAccess(
          userId,
          notificationTable.resourceId,
          notificationTable.resourceType,
        ),
      ),
    )
    .groupBy(notificationTable.workspaceId);
  return new Map(rows.map((row) => [row.workspaceId, row.unread]));
}

function dueLabelFormatter(timeZone: string, locale: string | null) {
  try {
    return new Intl.DateTimeFormat(locale ?? "en-US", {
      timeZone,
      month: "short",
      day: "numeric",
    });
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    });
  }
}

function mentionUrl(row: {
  resourceType: string | null;
  resourceId: string | null;
  workspaceId: string | null;
  eventData: unknown;
}): string | null {
  const projectId =
    row.eventData && typeof row.eventData === "object"
      ? (row.eventData as Record<string, unknown>).projectId
      : null;
  if (
    row.resourceType === "task" &&
    row.resourceId &&
    row.workspaceId &&
    typeof projectId === "string"
  ) {
    return buildTaskUrl(row.workspaceId, projectId, row.resourceId);
  }
  return null;
}

/** The digest's workspaces; empty when there is nothing to tell. */
export async function buildDigestWorkspaces(
  input: DigestInput,
): Promise<DigestWorkspace[]> {
  const workspaces = await digestWorkspacesOf(input.userId);
  if (workspaces.length === 0) return [];
  const ids = workspaces.map((workspace) => workspace.id);

  const [dueRows, mentionRows, unread, updateRows] = await Promise.all([
    dueTasksOf(input.userId, ids, input.now),
    mentionsOf(input.userId, ids, input.since),
    unreadCountsOf(input.userId, ids, input.since, input.now),
    projectUpdatesOf(input.userId, ids, input.since),
  ]);
  const formatDue = dueLabelFormatter(input.timeZone, input.locale);

  const result: DigestWorkspace[] = [];
  for (const workspace of workspaces) {
    const due = dueRows.filter((row) => row.workspaceId === workspace.id);
    const dueTasks: DigestTask[] = due.slice(0, MAX_DUE_LISTED).map((row) => ({
      title: row.title,
      url: buildTaskUrl(workspace.id, row.projectId, row.id),
      projectName: row.projectName,
      dueLabel: row.dueDate ? formatDue.format(row.dueDate) : "",
      overdue: Boolean(row.dueDate && row.dueDate < input.now),
    }));
    const mentions = mentionRows.filter(
      (row) => row.workspaceId === workspace.id,
    );
    const listedMentions: DigestMention[] = mentions
      .slice(0, MAX_MENTIONS_LISTED)
      .map((row) => {
        const content = buildRecipientDeliveryContent(
          {
            type: row.type,
            title: row.title ?? null,
            content: row.content ?? null,
            eventData:
              row.eventData && typeof row.eventData === "object"
                ? (row.eventData as Record<string, unknown>)
                : null,
          },
          input.locale,
        );
        return {
          id: row.id,
          title: content.title,
          detail: content.body,
          url: mentionUrl(row),
        };
      });
    const unreadCount = unread.get(workspace.id) ?? 0;
    const projectUpdates: DigestProjectUpdate[] = updateRows
      .filter((row) => row.workspaceId === workspace.id)
      .slice(0, MAX_PROJECT_UPDATES_LISTED)
      .map((row) => ({
        projectName: row.projectName,
        health: row.health,
        summary:
          row.summary.length > PROJECT_UPDATE_SUMMARY_CHARS
            ? `${row.summary.slice(0, PROJECT_UPDATE_SUMMARY_CHARS)}…`
            : row.summary,
        url: projectUpdatesUrl(workspace.id, row.projectId),
      }));
    const brief = input.includeBrief
      ? await briefSection(
          input.userId,
          workspace.id,
          input.now,
          input.since,
          input.timeZone,
        )
      : null;

    if (
      dueTasks.length === 0 &&
      mentions.length === 0 &&
      unreadCount === 0 &&
      !brief &&
      projectUpdates.length === 0
    ) {
      continue;
    }
    result.push({
      name: workspace.name,
      inboxUrl: workspaceInboxUrl(workspace.id),
      dueTasks,
      moreDueTasks: due.length - dueTasks.length,
      mentions: listedMentions,
      mentionCount: mentions.length,
      unreadCount,
      ...(brief ? { brief } : {}),
      ...(projectUpdates.length > 0 ? { projectUpdates } : {}),
    });
  }
  return result;
}
