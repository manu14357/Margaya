import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import { taskRecurrenceTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import { spawnNextInstance } from "./spawn";

/**
 * A completed repeating task creates its next instance. Every status write
 * (task routes, bulk edits, integrations, MCP) publishes this event;
 * spawnNextInstance checks the task really is completed and is idempotent.
 */
export async function handleRecurringCompletion(data: {
  taskId?: string;
  userId?: string | null;
}) {
  if (!data.taskId) return null;
  const [rule] = await db
    .select({
      id: taskRecurrenceTable.id,
      trigger: taskRecurrenceTable.trigger,
    })
    .from(taskRecurrenceTable)
    .where(eq(taskRecurrenceTable.taskId, data.taskId))
    .limit(1);
  if (!rule || rule.trigger !== "completion") return null;
  return spawnNextInstance({
    ruleId: rule.id,
    sourceTaskId: data.taskId,
    reason: "completion",
    actorId: data.userId || null,
  });
}

/**
 * The scheduled auto-close automation moves stale tasks to a cancelled column
 * in bulk and publishes no per-task status event. A repeating task it closes
 * still creates its next instance, so the series outlives one stale
 * occurrence.
 */
export async function handleAutoClosedTasks(data: {
  rule?: string;
  taskIds?: string[];
}) {
  if (data.rule !== "auto_close" || !data.taskIds?.length) return [];
  const rules = await db
    .select({
      id: taskRecurrenceTable.id,
      taskId: taskRecurrenceTable.taskId,
    })
    .from(taskRecurrenceTable)
    .where(
      and(
        inArray(taskRecurrenceTable.taskId, data.taskIds),
        eq(taskRecurrenceTable.trigger, "completion"),
      ),
    );
  const spawned = [];
  for (const rule of rules) {
    try {
      const next = await spawnNextInstance({
        ruleId: rule.id,
        sourceTaskId: rule.taskId,
        reason: "completion",
        actorId: null,
        acceptClosed: true,
      });
      if (next) spawned.push(next);
    } catch (error) {
      // One series failing must not stop the others; ids only in logs.
      console.error(
        `recurrence: auto-closed task ${rule.taskId} failed`,
        error,
      );
    }
  }
  return spawned;
}

subscribeToEvent<{ rule?: string; taskIds?: string[] }>(
  "task.automation_applied",
  async (data) => {
    await handleAutoClosedTasks(data);
  },
);

subscribeToEvent<{ taskId?: string; userId?: string | null }>(
  "task.status_changed",
  async (data) => {
    await handleRecurringCompletion(data);
  },
);
