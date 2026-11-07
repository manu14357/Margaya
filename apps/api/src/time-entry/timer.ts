import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type db from "../database";
import { taskTable, timeEntryTable } from "../database/schema";
import { MAX_DURATION_SECONDS } from "./duration";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// pg_advisory_xact_lock class for a person's timer (1524–1530 are taken). Two
// simultaneous starts would otherwise both see nothing running.
const TIMER_LOCK = 1531;

/**
 * The end and duration that close a running entry at `now`. Unlike a typed
 * range this never fails: an entry started in the future closes at its own
 * start, and an implausibly long one at the longest duration the column holds,
 * so a stray entry can't keep someone from stopping or starting a timer.
 */
export function closingValues(startTime: Date, now: Date) {
  const endTime = now.getTime() < startTime.getTime() ? startTime : now;
  const elapsed = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
  return { endTime, duration: Math.min(elapsed, MAX_DURATION_SECONDS) };
}

/**
 * Keeps a person to one running timer: closes whatever they have running, in
 * any workspace and on trashed tasks too, so nothing is left to come back
 * running when a task is restored. A project-limited API key can't reach
 * beyond its projects (`withinProjects`), so the person's other timers keep
 * running and go unnamed until they next start one themselves. The lock holds
 * until the caller's transaction ends, so it covers the insert that follows.
 */
export async function stopRunningEntries(
  tx: Transaction,
  userId: string,
  now: Date,
  withinProjects?: readonly string[] | null,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${TIMER_LOCK}, hashtext(${userId}))`,
  );

  const running = await tx
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      startTime: timeEntryTable.startTime,
    })
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.userId, userId),
        isNull(timeEntryTable.endTime),
        withinProjects?.length
          ? inArray(
              timeEntryTable.taskId,
              tx
                .select({ id: taskTable.id })
                .from(taskTable)
                .where(inArray(taskTable.projectId, [...withinProjects])),
            )
          : undefined,
      ),
    );

  for (const entry of running) {
    await tx
      .update(timeEntryTable)
      .set(closingValues(entry.startTime, now))
      .where(eq(timeEntryTable.id, entry.id));
  }

  return running.map(({ id, taskId }) => ({ id, taskId }));
}
