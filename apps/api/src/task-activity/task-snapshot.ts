import { eq, inArray } from "drizzle-orm";
import db from "../database";
import { projectTable, taskTable } from "../database/schema";

/** A task as history remembers it when a row is written. */
export type TaskSnapshot = {
  id: string;
  key: string;
  title: string;
  projectId: string;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database or a transaction; only selects. */
type Reader = Pick<Transaction, "select">;

/** The task key users type and paste: "WEB-12" (slug in upper case). */
export function formatTaskKey(slug: string, number: number | null): string {
  return `${slug.toUpperCase()}-${number ?? 0}`;
}

/** Snapshots of these tasks (missing ids are left out), in one query. */
export async function loadTaskSnapshots(
  taskIds: readonly string[],
  reader: Reader = db,
): Promise<Map<string, TaskSnapshot>> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await reader
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      projectId: taskTable.projectId,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(inArray(taskTable.id, ids));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        key: formatTaskKey(row.slug, row.number),
        title: row.title,
        projectId: row.projectId,
      },
    ]),
  );
}
