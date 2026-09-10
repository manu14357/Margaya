import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { TIME_ENTRY_NOT_FOUND } from "../access";
import { resolveDuration } from "../duration";

type UpdateTimeEntryParams = {
  timeEntryId: string;
  userId: string;
  /** Whether the caller may change entries others logged (as for delete). */
  mayChangeOthers: () => Promise<boolean>;
  startTime: Date;
  endTime?: Date;
  description?: string;
};

async function updateTimeEntry(params: UpdateTimeEntryParams) {
  const { timeEntryId, userId, mayChangeOthers, startTime, endTime } = params;
  const { description } = params;

  const [existingTimeEntry] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId));

  if (!existingTimeEntry) {
    throw new HTTPException(404, { message: TIME_ENTRY_NOT_FOUND });
  }
  if (existingTimeEntry.userId !== userId && !(await mayChangeOthers())) {
    throw new HTTPException(403, {
      message: "Only the person who logged this time can change it",
    });
  }

  const effectiveEndTime = endTime ?? existingTimeEntry.endTime;

  const duration = resolveDuration(startTime, effectiveEndTime ?? undefined);

  const [updatedTimeEntry] = await db
    .update(timeEntryTable)
    .set({
      startTime,
      endTime: effectiveEndTime,
      duration,
      ...(description !== undefined && { description }),
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  return updatedTimeEntry;
}

export default updateTimeEntry;
