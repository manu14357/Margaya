import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { TIME_ENTRY_NOT_FOUND } from "../access";
import { closingValues } from "../timer";

/**
 * Stops a running entry at the server's clock, so a device with a wrong clock
 * can't produce a negative range. Stopping one that already ended changes
 * nothing and answers with it: a second tab or a double click is not an error.
 */
async function stopTimeEntry({
  timeEntryId,
  userId,
  mayChangeOthers,
}: {
  timeEntryId: string;
  userId: string;
  mayChangeOthers: () => Promise<boolean>;
}) {
  const [entry] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId))
    .limit(1);
  if (!entry) throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });

  if (entry.userId !== userId && !(await mayChangeOthers())) {
    throw new HTTPException(403, {
      message: "Only the person who logged this time can change it",
    });
  }

  if (entry.endTime) return entry;

  const [stopped] = await db
    .update(timeEntryTable)
    .set(closingValues(entry.startTime, new Date()))
    .where(
      and(eq(timeEntryTable.id, timeEntryId), isNull(timeEntryTable.endTime)),
    )
    .returning();
  if (stopped) return stopped;

  // Stopped by another request between the read and the write.
  const [current] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId))
    .limit(1);
  if (!current) throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });
  return current;
}

export default stopTimeEntry;
