import { and, asc, count, eq, isNull, max, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { pageTable } from "../database/schema";
import type { Transaction } from "./controllers/shared";
import { PAGE_MESSAGES } from "./rules";
import { PAGE_LIMITS } from "./types";

// Tree helpers that read or write the database. Callers hold the project's
// tree lock (`lockPageTree`).

function siblingCondition(projectId: string, parentId: string | null): SQL {
  return and(
    eq(pageTable.projectId, projectId),
    parentId === null
      ? isNull(pageTable.parentId)
      : eq(pageTable.parentId, parentId),
  ) as SQL;
}

/** Sibling ids in order (hidden ones included): position, then id. */
export async function siblingOrder(
  tx: Transaction,
  projectId: string,
  parentId: string | null,
): Promise<string[]> {
  const rows = await tx
    .select({ id: pageTable.id })
    .from(pageTable)
    .where(siblingCondition(projectId, parentId))
    .orderBy(asc(pageTable.position), asc(pageTable.id));
  return rows.map((row) => row.id);
}

/** max(position) + 1 among the siblings (0 for the first). */
export async function nextPosition(
  tx: Transaction,
  projectId: string,
  parentId: string | null,
): Promise<number> {
  const [row] = await tx
    .select({ value: max(pageTable.position) })
    .from(pageTable)
    .where(siblingCondition(projectId, parentId));
  return row?.value === null || row?.value === undefined ? 0 : row.value + 1;
}

/** Writes positions 0..n-1 in `orderedIds` order (only rows that change). */
export async function writeSiblingOrder(
  tx: Transaction,
  orderedIds: readonly string[],
  current: ReadonlyMap<string, number>,
) {
  for (const [position, id] of orderedIds.entries()) {
    if (current.get(id) === position) continue;
    await tx.update(pageTable).set({ position }).where(eq(pageTable.id, id));
  }
}

/** Current positions of the given pages. */
export async function positionsOf(
  tx: Transaction,
  projectId: string,
  parentId: string | null,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: pageTable.id, position: pageTable.position })
    .from(pageTable)
    .where(siblingCondition(projectId, parentId));
  return new Map(rows.map((row) => [row.id, row.position]));
}

/** T8: 409 when `adding` more pages would pass 5,000 in the project. */
export async function assertProjectPageRoom(
  tx: Transaction,
  projectId: string,
  adding: number,
  message: string = PAGE_MESSAGES.projectLimit,
) {
  const [row] = await tx
    .select({ total: count() })
    .from(pageTable)
    .where(eq(pageTable.projectId, projectId));
  if ((row?.total ?? 0) + adding > PAGE_LIMITS.pagesPerProject) {
    throw new HTTPException(409, { message });
  }
}
