import { and, count, eq, ne } from "drizzle-orm";
import db from "../database";
import { userTable, workspaceUserTable } from "../database/schema";

// Billable seats: workspace members who are people. AI agents are members
// too (ai-agent/), but never a seat.

/** Members of the workspace who are people (agents excluded). */
export async function billableMemberCount(
  workspaceId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(workspaceUserTable)
    .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        ne(userTable.kind, "agent"),
      ),
    );
  return row?.value ?? 0;
}
