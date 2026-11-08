import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import db from "../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { notHiddenProject } from "../project/visibility";
import { inTriageColumnSql, liveTaskCondition } from "../task/scope";
import {
  readableEventDataSql,
  redactActivityRows,
} from "../task-activity/redact";
import { escapeLikePattern } from "./like-pattern";
import { TASK_SHORT_ID_PATTERN } from "./task-short-id";
import {
  computedMatch,
  headlineOf,
  indexedMatch,
  parseHeadline,
  rankOf,
  type SearchSnippet,
  type TextQuery,
  tieredScore,
  tsvectorOf,
} from "./text-query";

// Ranked full-text readers over tasks and comments, the two kinds with an
// indexed `search_tsv` column (migration 0032). Global search and
// `searchWorkspace` both build on them, so permission filtering lives here:
// only live tasks in live, visible projects of the given workspaces, and no
// intake requests that are not accepted yet (B7).

export type SourceScope = {
  /** Workspaces the caller is a member of; never empty. */
  workspaceIds: readonly string[];
  /** Restricted projects the caller may not see (project/visibility.ts). */
  hidden: readonly string[];
  projectId?: string;
  query: TextQuery;
  limit: number;
};

export type TaskHit = {
  id: string;
  title: string;
  description: string | null;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
  taskNumber: number | null;
  priority: string | null;
  status: string;
  score: number;
  snippet?: SearchSnippet;
};

export type CommentHit = {
  id: string;
  type: string;
  content: string | null;
  eventData: unknown;
  taskId: string;
  taskTitle: string | null;
  taskNumber: number | null;
  projectId: string | null;
  projectName: string | null;
  projectSlug: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: Date;
  score: number;
  snippet?: SearchSnippet;
};

/** Score of an exact task key match ("WEB-12"): above every text match. */
export const EXACT_KEY_SCORE = 10;

export const taskSearchTsv = sql`${taskTable}.search_tsv`;
export const taskPendingTsv = sql`margaya_task_search_tsv(${taskTable.title}, ${taskTable.description}, ${taskTable.projectId}, ${taskTable.number})`;
export const taskTsv = sql`coalesce(${taskSearchTsv}, ${taskPendingTsv})`;

const commentSearchTsv = sql`${activityTable}.search_tsv`;
const commentPendingTsv = sql`margaya_comment_search_tsv(${activityTable.content})`;

/** Matches tasks by `task.search_tsv`, with the backfill fallback. */
export function taskTextMatch(query: TextQuery): SQL {
  return indexedMatch(taskSearchTsv, taskPendingTsv, query, [
    sql`${taskTable.title}`,
    sql`${taskTable.description}`,
  ]);
}

/** The relevance of a matched task: title or key 3, description 2, plus rank. */
export function taskScore(query: TextQuery): SQL<number> {
  return tieredScore(taskTsv, sql`${taskTable.title}`, query, {
    titleWeighted: true,
  });
}

function projectScope(scope: SourceScope): SQL | undefined {
  return and(
    inArray(projectTable.workspaceId, [...scope.workspaceIds]),
    isNull(projectTable.deletedAt),
    notHiddenProject(projectTable.id, scope.hidden),
    scope.projectId ? eq(projectTable.id, scope.projectId) : undefined,
  );
}

const taskColumns = {
  id: taskTable.id,
  title: taskTable.title,
  description: taskTable.description,
  projectId: taskTable.projectId,
  projectName: projectTable.name,
  projectSlug: projectTable.slug,
  workspaceId: projectTable.workspaceId,
  workspaceName: workspaceTable.name,
  userId: taskTable.userId,
  userName: userTable.name,
  createdAt: taskTable.createdAt,
  taskNumber: taskTable.number,
  priority: taskTable.priority,
  status: taskTable.status,
};

/**
 * The task whose key ("WEB-12", "ПА-3") is the whole query, if the caller
 * may see it. Keys are NFKC-normalized when stored, so the query is too.
 */
export async function findTaskByKey(scope: SourceScope): Promise<TaskHit[]> {
  const match = scope.query.raw.match(TASK_SHORT_ID_PATTERN);
  const slug = match?.[1];
  const number = Number(match?.[2]);
  if (
    !slug ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    number > 2_147_483_647
  ) {
    return [];
  }
  const rows = await db
    .select(taskColumns)
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        projectScope(scope),
        // A key may hold `_`, which `ilike` reads as "any one character";
        // escaping keeps the case-insensitive comparison without wildcards.
        ilike(projectTable.slug, escapeLikePattern(slug)),
        eq(taskTable.number, number),
        sql`not ${inTriageColumnSql}`,
        liveTaskCondition,
      ),
    )
    .limit(1);
  return rows.map((row) => ({ ...row, score: EXACT_KEY_SCORE }));
}

/** Tasks ranked by full-text relevance, with a description snippet. */
export async function findTasks(scope: SourceScope): Promise<TaskHit[]> {
  const score = taskScore(scope.query);
  const rows = await db
    .select({
      ...taskColumns,
      score: score.as("score"),
      headline: headlineOf(sql`${taskTable.description}`, scope.query).as(
        "headline",
      ),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        projectScope(scope),
        taskTextMatch(scope.query),
        sql`not ${inTriageColumnSql}`,
        liveTaskCondition,
      ),
    )
    .orderBy(desc(score), desc(taskTable.createdAt))
    .limit(scope.limit);
  return rows.map(({ headline, ...row }) => ({
    ...row,
    score: Number(row.score),
    snippet: row.description ? parseHeadline(headline) : undefined,
  }));
}

const commentColumns = {
  id: activityTable.id,
  type: activityTable.type,
  content: activityTable.content,
  eventData: activityTable.eventData,
  taskId: activityTable.taskId,
  taskTitle: taskTable.title,
  taskNumber: taskTable.number,
  projectId: projectTable.id,
  projectName: projectTable.name,
  projectSlug: projectTable.slug,
  workspaceId: projectTable.workspaceId,
  workspaceName: workspaceTable.name,
  userId: activityTable.userId,
  userName: userTable.name,
  createdAt: activityTable.createdAt,
};

/** Comments ranked by full-text relevance of their own text. */
export async function findComments(scope: SourceScope): Promise<CommentHit[]> {
  const tsv = sql`coalesce(${commentSearchTsv}, ${commentPendingTsv})`;
  const score = scope.query.noLexemes
    ? sql<number>`2::float8`
    : sql<number>`(2 + coalesce(${rankOf(tsv, scope.query)}, 0))::float8`;
  const rows = await db
    .select({
      ...commentColumns,
      score: score.as("score"),
      headline: headlineOf(sql`${activityTable.content}`, scope.query).as(
        "headline",
      ),
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(activityTable.userId, userTable.id))
    .where(
      and(
        eq(activityTable.type, "comment"),
        projectScope(scope),
        indexedMatch(commentSearchTsv, commentPendingTsv, scope.query, [
          sql`${activityTable.content}`,
        ]),
        sql`not ${inTriageColumnSql}`,
        // Comments of trashed tasks read as gone (C7).
        liveTaskCondition,
      ),
    )
    .orderBy(desc(score), desc(activityTable.createdAt))
    .limit(scope.limit);
  return rows.map(({ headline, ...row }) => ({
    ...row,
    score: Number(row.score),
    snippet: parseHeadline(headline),
  }));
}

/**
 * Task history other than comments (status, assignee and title changes…):
 * rows of tasks that match, or whose own text does. History has no stored
 * vector; it is computed for the workspace's rows, as the old substring
 * search scanned them, and scores below comments. A row can name another
 * project (task-activity/redact.ts): what the caller can't see neither
 * matches nor comes back.
 */
export async function findActivities(
  scope: SourceScope,
): Promise<CommentHit[]> {
  const ownText = sql`coalesce(${activityTable.content}, cast(${readableEventDataSql(scope.hidden)} as text), '')`;
  const ownHit = computedMatch([ownText], scope.query);
  const score = sql<number>`(case when ${ownHit} then 2 else 1 end)::float8`;
  const rows = await db
    .select({ ...commentColumns, score: score.as("score") })
    .from(activityTable)
    .innerJoin(taskTable, eq(activityTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(activityTable.userId, userTable.id))
    .where(
      and(
        ne(activityTable.type, "comment"),
        projectScope(scope),
        liveTaskCondition,
        sql`(${taskTextMatch(scope.query)} or ${ownHit})`,
      ),
    )
    .orderBy(desc(score), desc(activityTable.createdAt))
    .limit(scope.limit);
  const redacted = await redactActivityRows(rows, scope);
  return redacted.map((row) => ({ ...row, score: Number(row.score) }));
}

/** Relevance and match for a small table without a stored vector. */
export function computedScore(
  title: SQL,
  description: SQL,
  query: TextQuery,
): { match: SQL; score: SQL<number> } {
  const document = sql`coalesce(${title}, '') || ' ' || coalesce(${description}, '')`;
  return {
    match: computedMatch([title, description], query),
    score: tieredScore(tsvectorOf(document), title, query, {
      titleWeighted: false,
    }),
  };
}
