import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, timeEntryTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { resolveDuration } from "../duration";
import { stopRunningEntries } from "../timer";

async function createTimeEntry({
  taskId,
  userId,
  description,
  startTime,
  endTime,
  stopWithinProjects,
}: {
  taskId: string;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  /** A project-limited API key's projects: other timers are out of its reach. */
  stopWithinProjects?: readonly string[] | null;
}) {
  const duration = resolveDuration(startTime, endTime);

  const { createdTimeEntry, stoppedEntries } = await db.transaction(
    async (tx) => {
      // Only an open entry is a timer; logging a finished range stops nothing.
      const stoppedEntries = endTime
        ? []
        : await stopRunningEntries(tx, userId, new Date(), stopWithinProjects);

      const [createdTimeEntry] = await tx
        .insert(timeEntryTable)
        .values({
          id: createId(),
          taskId,
          userId,
          description: description || "",
          startTime,
          endTime: endTime || null,
          duration,
        })
        .returning();

      if (!createdTimeEntry) {
        throw new HTTPException(500, {
          message: "Failed to create time entry",
        });
      }

      return { createdTimeEntry, stoppedEntries };
    },
  );

  const [task] = await db
    .select({ userId: taskTable.userId, title: taskTable.title })
    .from(taskTable)
    .where(eq(taskTable.id, taskId));

  await publishEvent("time-entry.created", {
    timeEntryId: createdTimeEntry.id,
    taskId: createdTimeEntry.taskId,
    userId,
    type: "create",
    content: "started time tracking",
    taskOwnerId: task?.userId,
    taskTitle: task?.title,
  });

  return { ...createdTimeEntry, stoppedEntries };
}

export default createTimeEntry;
