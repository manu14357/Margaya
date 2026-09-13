import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import db from "../../database";
import {
  pageReferenceTable,
  pageTable,
  projectTable,
} from "../../database/schema";
import { projectFeatureEnabledCondition } from "../../project/features";
import type { PageCaller } from "../rules";
import {
  loadVisiblePage,
  pageSummaryColumns,
  projectParentMap,
  toPageSummary,
  visiblePageCondition,
} from "./shared";

/**
 * Visible, non-archived pages of the workspace, in projects with Pages on,
 * whose content references the entity.
 */
async function pagesReferencing({
  workspaceId,
  entityType,
  entityId,
  caller,
}: {
  workspaceId: string;
  entityType: "page" | "task";
  entityId: string;
  caller: PageCaller;
}) {
  const rows = await db
    .select(pageSummaryColumns)
    .from(pageReferenceTable)
    .innerJoin(pageTable, eq(pageTable.id, pageReferenceTable.pageId))
    .innerJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .where(
      and(
        eq(pageReferenceTable.entityType, entityType),
        eq(pageReferenceTable.entityId, entityId),
        eq(pageTable.workspaceId, workspaceId),
        isNull(pageTable.archivedAt),
        projectFeatureEnabledCondition("pages"),
        visiblePageCondition(caller),
      ) as SQL,
    )
    .orderBy(asc(pageTable.title), asc(pageTable.id))
    .limit(200);

  const projectIds = [
    ...new Set(rows.map((row) => row.projectId).filter((id) => id !== null)),
  ];
  const parentOf = new Map<string, string | null>();
  for (const projectId of projectIds) {
    for (const [id, parentId] of await projectParentMap(db, projectId)) {
      parentOf.set(id, parentId);
    }
  }
  return rows.map((row) => toPageSummary(row, caller, parentOf));
}

/** Pages linking to this page (backlinks). */
export async function listPageBacklinks(pageId: string, caller: PageCaller) {
  const page = await loadVisiblePage(db, pageId, caller);
  return pagesReferencing({
    workspaceId: page.workspaceId,
    entityType: "page",
    entityId: page.id,
    caller,
  });
}

/** Pages that link to a task. */
export async function listTaskPageReferences(
  taskId: string,
  workspaceId: string,
  caller: PageCaller,
) {
  return pagesReferencing({
    workspaceId,
    entityType: "task",
    entityId: taskId,
    caller,
  });
}
