import { and, asc, eq, ne } from "drizzle-orm";
import db from "../../database";
import { columnTable } from "../../database/schema";

async function getColumns(projectId: string, includeTriage = false) {
  const columns = await db
    .select()
    .from(columnTable)
    .where(
      includeTriage
        ? eq(columnTable.projectId, projectId)
        : and(
            eq(columnTable.projectId, projectId),
            ne(columnTable.group, "triage"),
          ),
    )
    .orderBy(asc(columnTable.position));

  return columns;
}

export default getColumns;
