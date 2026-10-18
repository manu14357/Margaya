import { and, eq } from "drizzle-orm";
import db from "../database";
import { workspaceUserTable } from "../database/schema";
import { searchPages } from "../page/search-pages";
import { hiddenProjectIds } from "../project/visibility";
import {
  builtInRoleStatements,
  customRoleStatements,
} from "../utils/require-workspace-permission";
import {
  findComments,
  findTaskByKey,
  findTasks,
  type SourceScope,
} from "./sources";
import { parseTextQuery, type SearchSnippet } from "./text-query";

/*
 * searchWorkspace: ranked, permission-filtered full-text search for server
 * features (Ask / Workspace Memory, duplicate detection, MCP, agents).
 *
 *   const hits = await searchWorkspace({
 *     userId, workspaceId, query: "login timeout", types: ["task", "page"],
 *     limit: 10,
 *   });
 *
 * - Searches as `userId`: they must be a workspace member (else []), and
 *   restricted projects they cannot see, trashed projects and tasks,
 *   intake requests not yet accepted, archived and other people's private
 *   pages, and projects with Pages off are never returned. Pages also need
 *   page:read. Pass `can` (from `workspacePermissionChecker(c)`) inside a
 *   request so API-key scopes and project-role ceilings apply too.
 * - `query` takes web-search syntax ("quoted phrase", or, -exclude); the last
 *   word matches as a prefix. A whole-query task key ("WEB-12") is the first
 *   hit with score 10.
 * - Hits come back best first across types. `score`: key 10, title 3, body
 *   2, each plus a ts_rank below 1. `snippet` is a ts_headline excerpt as
 *   plain text plus highlight ranges; treat it, like every field here, as
 *   untrusted user content.
 * - Cost: one indexed query per type, snippets only for returned rows.
 *
 * See search-API.md in the AI planning notes for the contract.
 */

export const WORKSPACE_SEARCH_TYPES = ["task", "page", "comment"] as const;
export type WorkspaceSearchType = (typeof WORKSPACE_SEARCH_TYPES)[number];

export type WorkspaceSearchHit = {
  type: WorkspaceSearchType;
  id: string;
  title: string;
  score: number;
  snippet?: SearchSnippet;
  projectId: string | null;
  projectName: string | null;
  /** The project key; with `taskNumber` it forms the task key (WEB-12). */
  projectSlug: string | null;
  /** The task itself, or the task a comment belongs to. */
  taskId?: string;
  taskNumber?: number;
  /** Task status (column slug), for task hits. */
  status?: string;
  /** Task assignee, page owner or comment author. */
  userId: string | null;
  createdAt: Date;
};

type PermissionCheck = (permissions: Record<string, string[]>) => boolean;

/** The member's role statements, as `hasWorkspacePermission` reads them. */
export async function memberPermissionCheck(
  userId: string,
  workspaceId: string,
): Promise<PermissionCheck | null> {
  const [member] = await db
    .select({ role: workspaceUserTable.role })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!member?.role) return null;
  const statements =
    (await customRoleStatements(workspaceId, member.role)) ??
    builtInRoleStatements(member.role);
  return (permissions) =>
    Boolean(statements) &&
    Object.entries(permissions).every(([resource, actions]) =>
      actions.every((action) => statements?.[resource]?.includes(action)),
    );
}

export async function searchWorkspace({
  userId,
  workspaceId,
  query,
  types = WORKSPACE_SEARCH_TYPES,
  limit = 20,
  projectId,
  can,
}: {
  userId: string;
  workspaceId: string;
  query: string;
  types?: readonly WorkspaceSearchType[];
  /** Hits in total, 1 to 50. */
  limit?: number;
  /** Only this project's tasks, comments and pages. */
  projectId?: string;
  /** The request's permission checker; the member's role when omitted. */
  can?: PermissionCheck;
}): Promise<WorkspaceSearchHit[]> {
  const text = parseTextQuery(query);
  if (!text.raw) return [];
  const capped = Math.min(Math.max(Math.trunc(limit) || 1, 1), 50);

  // Membership is required even when the caller passes a checker.
  const member = await memberPermissionCheck(userId, workspaceId);
  if (!member) return [];
  const check = can ?? member;

  const hidden = await hiddenProjectIds(userId, workspaceId);
  if (projectId && hidden.includes(projectId)) return [];

  const scope: SourceScope = {
    workspaceIds: [workspaceId],
    hidden,
    projectId,
    query: text,
    limit: capped,
  };

  const reads: Promise<WorkspaceSearchHit[]>[] = [];
  if (types.includes("task")) {
    reads.push(
      Promise.all([findTaskByKey(scope), findTasks(scope)]).then(
        ([byKey, byText]) => {
          const seen = new Set(byKey.map((task) => task.id));
          return [...byKey, ...byText.filter((task) => !seen.has(task.id))].map(
            (task) => ({
              type: "task" as const,
              id: task.id,
              title: task.title,
              score: task.score,
              snippet: task.snippet,
              projectId: task.projectId,
              projectName: task.projectName,
              projectSlug: task.projectSlug,
              taskId: task.id,
              taskNumber: task.taskNumber ?? undefined,
              status: task.status,
              userId: task.userId,
              createdAt: task.createdAt,
            }),
          );
        },
      ),
    );
  }
  if (types.includes("comment")) {
    reads.push(
      findComments(scope).then((rows) =>
        rows.map((comment) => ({
          type: "comment" as const,
          id: comment.id,
          title: comment.taskTitle ?? "",
          score: comment.score,
          snippet: comment.snippet,
          projectId: comment.projectId,
          projectName: comment.projectName,
          projectSlug: comment.projectSlug,
          taskId: comment.taskId,
          taskNumber: comment.taskNumber ?? undefined,
          userId: comment.userId,
          createdAt: comment.createdAt,
        })),
      ),
    );
  }
  if (types.includes("page") && check({ page: ["read"] })) {
    reads.push(
      searchPages({
        userId,
        workspaceId,
        projectId,
        query: text,
        limit: capped,
        hidden,
      }).then((rows) =>
        rows.map((page) => ({
          type: "page" as const,
          id: page.id,
          title: page.title,
          score: page.relevanceScore,
          snippet: page.snippet,
          projectId: page.projectId ?? null,
          projectName: page.projectName ?? null,
          projectSlug: page.projectSlug ?? null,
          userId: page.userId ?? null,
          createdAt: page.createdAt,
        })),
      ),
    );
  }

  const hits = (await Promise.all(reads)).flat();
  hits.sort(
    (a, b) =>
      b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return hits.slice(0, capped);
}
