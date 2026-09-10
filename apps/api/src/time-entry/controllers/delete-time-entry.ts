import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { TIME_ENTRY_NOT_FOUND } from "../access";

/**
 * Deletes a time entry. Its author may always delete it; anyone else needs
 * the right to delete tasks (workspace admins and owners by default). An
 * entry whose author was removed can only be deleted that way.
 */
async function deleteTimeEntry({
  timeEntryId,
  userId,
  mayDeleteOthers,
}: {
  timeEntryId: string;
  userId: string;
  mayDeleteOthers: () => Promise<boolean>;
}) {
  const [entry] = await db
    .select({ userId: timeEntryTable.userId })
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId))
    .limit(1);
  if (!entry) throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });

  if (entry.userId !== userId && !(await mayDeleteOthers())) {
    throw new HTTPException(403, {
      message: "Only the person who logged this time can delete it",
    });
  }

  const [deleted] = await db
    .delete(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();
  if (!deleted) throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });

  return deleted;
}

export default deleteTimeEntry;
