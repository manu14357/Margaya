import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import { TASK_SHORT_ID_PATTERN } from "../../search/task-short-id";
import { formatTaskKey } from "../../task-activity/task-snapshot";
import { inTriageColumnSql, liveTaskCondition } from "../scope";

const NOT_FOUND = "Task not found";
const MAX_TASK_NUMBER = 2_147_483_647;

/** "web-12" → { slug: "web", number: 12 }, or null when it is not a key. */
export function parseTaskKey(
  key: string,
): { slug: string; number: number } | null {
  const match = key.trim().normalize("NFKC").match(TASK_SHORT_ID_PATTERN);
  const number = Number(match?.[2]);
  if (
    !match?.[1] ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > MAX_TASK_NUMBER
  ) {
    return null;
  }
  return { slug: match[1], number };
}

/**
 * Resolves a readable task key (KEY-12, any case) inside one workspace.
 * Requests waiting in intake stay hidden, as they do in search; archived
 * tasks resolve, as their id links do. Drafts have no key, so never match.
 * Keys are unique per workspace ignoring case; for legacy duplicates the
 * oldest project wins, so a link keeps pointing at the same task.
 */
async function getTaskByKey(workspaceId: string, key: string) {
  const parsed = parseTaskKey(key);
  if (!parsed) throw new HTTPException(404, { message: NOT_FOUND });

  const [task] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        // `_` is a wildcard for ilike; escaping keeps the match exact.
        ilike(projectTable.slug, escapeLikePattern(parsed.slug)),
        eq(taskTable.number, parsed.number),
        sql`not ${inTriageColumnSql}`,
        // Trashed tasks and projects read as gone (C7).
        liveTaskCondition,
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(asc(projectTable.createdAt), asc(projectTable.id))
    .limit(1);

  if (!task) throw new HTTPException(404, { message: NOT_FOUND });

  return {
    id: task.id,
    projectId: task.projectId,
    number: task.number ?? parsed.number,
    key: formatTaskKey(task.slug, task.number),
  };
}

export default getTaskByKey;
