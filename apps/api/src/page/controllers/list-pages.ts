import { and, asc, eq, sql } from "drizzle-orm";
import db from "../../database";
import { pageTable } from "../../database/schema";
import type { PageCaller } from "../rules";
import {
  pageSummaryColumns,
  projectParentMap,
  toPageSummary,
  visiblePageCondition,
} from "./shared";

/**
 * Every page of the project the caller can see, archived ones included,
 * without content. Invisible pages are filtered in SQL.
 */
async function listPages({
  projectId,
  caller,
}: {
  projectId: string;
  caller: PageCaller;
}) {
  const [rows, parentOf] = await Promise.all([
    db
      .select(pageSummaryColumns)
      .from(pageTable)
      .where(
        and(eq(pageTable.projectId, projectId), visiblePageCondition(caller)),
      )
      .orderBy(
        sql`${pageTable.parentId} asc nulls first`,
        asc(pageTable.position),
        asc(pageTable.id),
      ),
    projectParentMap(db, projectId),
  ]);
  return rows.map((row) => toPageSummary(row, caller, parentOf));
}

export default listPages;
