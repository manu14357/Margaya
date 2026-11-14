import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  type SQL,
} from "drizzle-orm";
import type { Context } from "hono";
import db from "../../database";
import {
  projectTable,
  whiteboardTable,
  whiteboardTaskLinkTable,
} from "../../database/schema";
import { projectFeatureEnabledCondition } from "../../project/features";
import {
  hiddenFromUserAndKey,
  notHiddenProject,
  projectVisibleSql,
} from "../../project/visibility";
import { escapeLikePattern } from "../../search/like-pattern";
import { projectsCappedAgainst } from "../../utils/require-workspace-permission";
import { WHITEBOARD_LIMITS, type WhiteboardCaller } from "../rules";
import {
  type Reader,
  toWhiteboardSummaries,
  type WhiteboardSummaryRecord,
  whiteboardSummaryColumns,
} from "../shared";

/**
 * A project's live (or archived) boards, newest updated first. `q` matches
 * the title and the text on the board, ignoring case.
 */
export async function listWhiteboards({
  projectId,
  archived,
  q,
  caller,
}: {
  projectId: string;
  archived: boolean;
  q?: string;
  caller: WhiteboardCaller;
}) {
  const text = q?.trim();
  const pattern = text ? `%${escapeLikePattern(text)}%` : null;
  const conditions: (SQL | undefined)[] = [
    eq(whiteboardTable.projectId, projectId),
    isNull(whiteboardTable.deletedAt),
    archived
      ? isNotNull(whiteboardTable.archivedAt)
      : isNull(whiteboardTable.archivedAt),
    pattern
      ? or(
          ilike(whiteboardTable.title, pattern),
          ilike(whiteboardTable.contentText, pattern),
        )
      : undefined,
  ];
  const rows = await db
    .select(whiteboardSummaryColumns)
    .from(whiteboardTable)
    .where(and(...conditions))
    .orderBy(desc(whiteboardTable.updatedAt), desc(whiteboardTable.id));
  return { whiteboards: await toWhiteboardSummaries(rows, caller) };
}

/**
 * What the request may list across the workspace: projects hidden from the
 * user or outside a project-limited API key, plus those whose project role
 * withholds whiteboard:read, are left out; roles withholding update or
 * delete lower the caller's rights on that project's boards.
 */
export async function workspaceListScope(c: Context) {
  const [hidden, withoutRead, withoutUpdate, withoutDelete] = await Promise.all(
    [
      hiddenFromUserAndKey(c.get("userId"), c.get("workspaceId")),
      projectsCappedAgainst(c, { whiteboard: ["read"] }),
      projectsCappedAgainst(c, { whiteboard: ["update"] }),
      projectsCappedAgainst(c, { whiteboard: ["delete"] }),
    ],
  );
  return {
    hidden: [...new Set([...hidden, ...withoutRead])],
    withoutUpdate,
    withoutDelete,
  };
}

/**
 * The workspace's boards across projects, newest updated first, each with
 * its project. `hidden` holds the projects the caller may not list (hidden
 * from them or their API key, or whose project role withholds
 * whiteboard:read). `withoutUpdate` and `withoutDelete` are projects whose
 * role withholds those rights: they decide who sees a board's public link.
 */
export async function listWorkspaceWhiteboards({
  workspaceId,
  archived,
  q,
  caller,
  hidden,
  withoutUpdate,
  withoutDelete,
}: {
  workspaceId: string;
  archived: boolean;
  q?: string;
  caller: WhiteboardCaller;
  hidden: readonly string[];
  withoutUpdate: readonly string[];
  withoutDelete: readonly string[];
}) {
  const text = q?.trim();
  const pattern = text ? `%${escapeLikePattern(text)}%` : null;
  const rows = await db
    .select({
      ...whiteboardSummaryColumns,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      projectIcon: projectTable.icon,
    })
    .from(whiteboardTable)
    .innerJoin(projectTable, eq(projectTable.id, whiteboardTable.projectId))
    .where(
      and(
        eq(whiteboardTable.workspaceId, workspaceId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(whiteboardTable.deletedAt),
        archived
          ? isNotNull(whiteboardTable.archivedAt)
          : isNull(whiteboardTable.archivedAt),
        projectFeatureEnabledCondition("whiteboards"),
        notHiddenProject(whiteboardTable.projectId, hidden),
        pattern
          ? or(
              ilike(whiteboardTable.title, pattern),
              ilike(whiteboardTable.contentText, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(whiteboardTable.updatedAt), desc(whiteboardTable.id))
    .limit(WHITEBOARD_LIMITS.workspaceListSize);

  return workspaceBoardsResponse(rows, {
    caller,
    withoutUpdate,
    withoutDelete,
  });
}

type WorkspaceBoardRow = WhiteboardSummaryRecord & {
  projectName: string;
  projectSlug: string;
  projectIcon: string | null;
};

/**
 * Rows of the workspace list as its response: each summary with its project,
 * the caller's rights lowered where a project role withholds update or
 * delete.
 */
export async function workspaceBoardsResponse(
  rows: readonly WorkspaceBoardRow[],
  {
    caller,
    withoutUpdate,
    withoutDelete,
  }: {
    caller: WhiteboardCaller;
    withoutUpdate: readonly string[];
    withoutDelete: readonly string[];
  },
  reader: Reader = db,
) {
  const noUpdate = new Set(withoutUpdate);
  const noDelete = new Set(withoutDelete);
  const summaries = await toWhiteboardSummaries(
    rows,
    (row) => ({
      ...caller,
      canUpdate: caller.canUpdate && !noUpdate.has(row.projectId),
      isManager: caller.isManager && !noDelete.has(row.projectId),
    }),
    reader,
  );
  return {
    whiteboards: summaries.map((summary, index) => {
      const row = rows[index];
      return {
        ...summary,
        project: {
          id: summary.projectId,
          name: row?.projectName ?? "",
          slug: row?.projectSlug ?? "",
          icon: row?.projectIcon ?? null,
        },
      };
    }),
  };
}

/**
 * Live boards with a card for the task, in projects the caller can see and
 * where Whiteboards are on.
 */
export async function listTaskWhiteboards({
  taskId,
  workspaceId,
  caller,
}: {
  taskId: string;
  workspaceId: string;
  caller: WhiteboardCaller;
}) {
  const rows = await db
    .select(whiteboardSummaryColumns)
    .from(whiteboardTaskLinkTable)
    .innerJoin(
      whiteboardTable,
      eq(whiteboardTable.id, whiteboardTaskLinkTable.whiteboardId),
    )
    .innerJoin(projectTable, eq(projectTable.id, whiteboardTable.projectId))
    .where(
      and(
        eq(whiteboardTaskLinkTable.taskId, taskId),
        eq(whiteboardTable.workspaceId, workspaceId),
        isNull(whiteboardTable.deletedAt),
        isNull(whiteboardTable.archivedAt),
        projectFeatureEnabledCondition("whiteboards"),
        projectVisibleSql(whiteboardTable.projectId, caller.userId),
      ),
    )
    .orderBy(desc(whiteboardTable.updatedAt), desc(whiteboardTable.id));
  return { whiteboards: await toWhiteboardSummaries(rows, caller) };
}
