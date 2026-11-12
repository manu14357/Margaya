import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  exists,
  gte,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import db from "../database";
import {
  calendarFeedTable,
  cycleTable,
  projectTable,
  taskAssigneeTable,
  taskTable,
} from "../database/schema";
import { publicWebUrl } from "../utils/desktop-config";
import { todayInTimezone } from "../utils/zoned-date";
import { loadFeedAccess } from "./access";
import {
  FEED_MAX_EVENTS,
  type FeedContext,
  type FeedCycle,
  type FeedTask,
  feedEvents,
  feedWindow,
} from "./events";
import { buildCalendar } from "./ics";
import { hashFeedToken, isFeedTokenShape } from "./token";

// Renders a feed for its secret token. Anything that should not be served
// (unknown or revoked token, owner removed, project hidden or in the trash)
// returns null, which the route answers with a plain 404.

const DAY_MS = 86_400_000;
// lastUsedAt is written at most this often, so polling costs no write.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export type RenderedFeed = { body: string; etag: string; filename: string };

function touch(feedId: string, lastUsedAt: Date | null, now: Date) {
  if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) {
    return;
  }
  void db
    .update(calendarFeedTable)
    .set({ lastUsedAt: now })
    .where(eq(calendarFeedTable.id, feedId))
    .catch((error) => {
      console.error("Calendar feed last-used update failed:", error);
    });
}

export async function renderFeed(
  token: string,
  now: Date = new Date(),
): Promise<RenderedFeed | null> {
  if (!isFeedTokenShape(token)) return null;
  const [feed] = await db
    .select()
    .from(calendarFeedTable)
    .where(eq(calendarFeedTable.tokenHash, hashFeedToken(token)))
    .limit(1);
  if (!feed) return null;

  const access = await loadFeedAccess(feed.userId, feed.workspaceId);
  if (!access) return null;

  const projectId = feed.kind === "project" ? feed.projectId : null;
  if (feed.kind === "project") {
    if (!projectId || access.hiddenProjectIds.includes(projectId)) return null;
    const [project] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, projectId),
          eq(projectTable.workspaceId, feed.workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    if (!project) return null;
  }

  const today = todayInTimezone(access.timezone, now);
  const window = feedWindow(today);
  // A UTC margin of two days on each side; events() trims to the exact days.
  const lower = new Date(Date.parse(window.first) - 2 * DAY_MS).toISOString();
  const upper = new Date(Date.parse(window.last) + 2 * DAY_MS).toISOString();

  const taskConditions: (SQL | undefined)[] = [
    eq(projectTable.workspaceId, feed.workspaceId),
    isNull(projectTable.deletedAt),
    isNull(taskTable.deletedAt),
    isNull(taskTable.archivedAt),
    or(isNotNull(taskTable.startDate), isNotNull(taskTable.dueDate)),
    sql`coalesce(${taskTable.dueDate}, ${taskTable.startDate}) >= ${lower}::timestamp`,
    sql`coalesce(${taskTable.startDate}, ${taskTable.dueDate}) <= ${upper}::timestamp`,
    access.hiddenProjectIds.length > 0
      ? notInArray(projectTable.id, access.hiddenProjectIds)
      : undefined,
  ];
  if (feed.kind === "my_tasks") {
    taskConditions.push(
      isNull(projectTable.archivedAt),
      exists(
        db
          .select({ one: sql`1` })
          .from(taskAssigneeTable)
          .where(
            and(
              eq(taskAssigneeTable.taskId, taskTable.id),
              eq(taskAssigneeTable.userId, feed.userId),
            ),
          ),
      ),
    );
  } else if (feed.kind === "planning") {
    taskConditions.push(
      isNull(projectTable.archivedAt),
      eq(taskTable.isMilestone, true),
    );
  } else if (projectId) {
    taskConditions.push(eq(taskTable.projectId, projectId));
  }

  const tasks: FeedTask[] = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      projectId: taskTable.projectId,
      projectSlug: projectTable.slug,
      projectName: projectTable.name,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      isMilestone: taskTable.isMilestone,
      completedAt: taskTable.completedAt,
      updatedAt: taskTable.updatedAt,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(and(...taskConditions))
    .orderBy(
      asc(sql`coalesce(${taskTable.startDate}, ${taskTable.dueDate})`),
      asc(taskTable.id),
    )
    .limit(FEED_MAX_EVENTS);

  let cycles: FeedCycle[] = [];
  if (feed.kind !== "my_tasks" && access.canReadCycles) {
    const rows = await db
      .select({
        id: cycleTable.id,
        name: cycleTable.name,
        projectId: cycleTable.projectId,
        projectName: projectTable.name,
        startDate: cycleTable.startDate,
        endDate: cycleTable.endDate,
        updatedAt: cycleTable.updatedAt,
      })
      .from(cycleTable)
      .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
      .where(
        and(
          eq(projectTable.workspaceId, feed.workspaceId),
          isNull(projectTable.deletedAt),
          // Cycles turned off for a project are off here too.
          eq(projectTable.cyclesEnabled, true),
          isNull(cycleTable.archivedAt),
          isNotNull(cycleTable.startDate),
          isNotNull(cycleTable.endDate),
          gte(cycleTable.endDate, window.first),
          lte(cycleTable.startDate, window.last),
          projectId
            ? eq(cycleTable.projectId, projectId)
            : isNull(projectTable.archivedAt),
          access.cycleHiddenProjectIds.length > 0
            ? notInArray(projectTable.id, access.cycleHiddenProjectIds)
            : undefined,
        ),
      )
      .orderBy(asc(cycleTable.startDate), asc(cycleTable.id))
      .limit(FEED_MAX_EVENTS);
    cycles = rows.flatMap((row) =>
      row.startDate && row.endDate
        ? [{ ...row, startDate: row.startDate, endDate: row.endDate }]
        : [],
    );
  }

  const ctx: FeedContext = {
    workspaceId: feed.workspaceId,
    timezone: access.timezone,
    today,
    webUrl: publicWebUrl(),
    showProject: feed.kind !== "project",
  };
  const body = buildCalendar({
    name: feed.name,
    timezone: access.timezone,
    events: feedEvents(tasks, cycles, ctx),
  });

  touch(feed.id, feed.lastUsedAt, now);
  return {
    body,
    etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 32)}"`,
    filename: `margaya-${feed.kind.replace("_", "-")}.ics`,
  };
}
