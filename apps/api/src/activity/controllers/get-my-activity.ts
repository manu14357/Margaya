import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, projectTable, taskTable } from "../../database/schema";
import { notHiddenProject } from "../../project/visibility";
import { inTriageColumnSql, liveTaskCondition } from "../../task/scope";
import { formatTaskKey } from "../../task-activity/task-snapshot";

const DEFAULT_LIMIT = 10;
const INVALID_CURSOR = "Invalid cursor";

type Cursor = { createdAt: string; id: string };

// created_at has microseconds, a JS Date only milliseconds, so the cursor
// carries the database's own text form to stay exact.
const createdAtKey = sql<string>`to_char(${activityTable.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
const CURSOR_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;

function encodeCursor(cursor: Cursor) {
  return Buffer.from(
    JSON.stringify([cursor.createdAt, cursor.id]),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  const invalid = () => new HTTPException(400, { message: INVALID_CURSOR });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== "string" ||
    !CURSOR_TIME.test(parsed[0]) ||
    typeof parsed[1] !== "string" ||
    parsed[1].length === 0 ||
    parsed[1].length > 128
  ) {
    throw invalid();
  }
  return { createdAt: parsed[0], id: parsed[1] };
}

/**
 * One person's activity on the workspace's tasks, newest first: the caller's
 * own ("Your work") or a member's (their profile). Requests still in intake
 * and trashed tasks and projects are left out (they are not on the board);
 * drafts have no activity rows. Every workspace member sees every project
 * (D6), so anyone who may read tasks may read these rows.
 */
async function getMyActivity({
  userId,
  workspaceId,
  limit = DEFAULT_LIMIT,
  cursor,
  hidden = [],
}: {
  userId: string;
  workspaceId: string;
  limit?: number;
  cursor?: string;
  /** Restricted projects the viewer may not see (project/visibility.ts). */
  hidden?: readonly string[];
}) {
  const after = cursor ? decodeCursor(cursor) : null;

  const rows = await db
    .select({
      activity: activityTable,
      createdAtKey,
      task: {
        id: taskTable.id,
        title: taskTable.title,
        number: taskTable.number,
        projectId: taskTable.projectId,
      },
      projectSlug: projectTable.slug,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(activityTable.userId, userId),
        eq(projectTable.workspaceId, workspaceId),
        liveTaskCondition,
        isNull(projectTable.deletedAt),
        notHiddenProject(projectTable.id, hidden),
        sql`not ${inTriageColumnSql}`,
        after
          ? sql`(${activityTable.createdAt}, ${activityTable.id}) < (${after.createdAt}::timestamp, ${after.id})`
          : undefined,
      ),
    )
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      ...row.activity,
      task: {
        id: row.task.id,
        key: formatTaskKey(row.projectSlug, row.task.number),
        title: row.task.title,
        projectId: row.task.projectId,
      },
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ createdAt: last.createdAtKey, id: last.activity.id })
        : null,
  };
}

export default getMyActivity;
