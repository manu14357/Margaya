import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable, taskTable } from "../../database/schema";
import { inTriageColumnSql } from "../../task/scope";
import { formatTaskKey } from "../../task-activity/task-snapshot";
import { publishIntakeItemUpdated } from "../events";
import { normalizeNote, parseSnoozeUntil } from "../status";
import { runIntakeTransition } from "./shared";

// Decline, snooze, unsnooze, mark duplicate and reopen: one locked UPDATE of
// the request each, then intake.item_updated.

type Actor = { itemId: string; workspaceId: string; userId: string };

export async function declineIntakeItem({
  note,
  ...actor
}: Actor & { note?: string }) {
  const resolutionNote = normalizeNote(note);
  const { item, previousStatus } = await runIntakeTransition({
    itemId: actor.itemId,
    userId: actor.userId,
    action: "decline",
    input: { note: resolutionNote },
  });
  await publishIntakeItemUpdated({
    item,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: "declined",
    previousStatus,
    extras: { note: resolutionNote },
  });
  return item;
}

export async function snoozeIntakeItem({
  until,
  ...actor
}: Actor & { until: string }) {
  const snoozedUntil = parseSnoozeUntil(until, new Date());
  const { item, previousStatus } = await runIntakeTransition({
    itemId: actor.itemId,
    userId: actor.userId,
    action: "snooze",
    input: { snoozedUntil },
  });
  await publishIntakeItemUpdated({
    item,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: "snoozed",
    previousStatus,
    extras: { snoozedUntil: snoozedUntil.toISOString() },
  });
  return item;
}

export async function unsnoozeIntakeItem(actor: Actor) {
  const { item, previousStatus } = await runIntakeTransition({
    itemId: actor.itemId,
    userId: actor.userId,
    action: "unsnooze",
  });
  await publishIntakeItemUpdated({
    item,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: "unsnoozed",
    previousStatus,
  });
  return item;
}

export async function reopenIntakeItem(actor: Actor) {
  const { item, previousStatus } = await runIntakeTransition({
    itemId: actor.itemId,
    userId: actor.userId,
    action: "reopen",
  });
  await publishIntakeItemUpdated({
    item,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: "reopened",
    previousStatus,
  });
  return item;
}

export const TASK_NOT_FOUND = "Task not found";
export const SELF_DUPLICATE = "A request can't duplicate itself";
export const DUPLICATE_NOT_VISIBLE =
  "Pick a task from this project's board or backlog";

/**
 * Marks a request as a duplicate of a visible task of the same project.
 * Tasks elsewhere answer 404 like unknown ones, so nothing leaks.
 */
export async function markIntakeItemDuplicate({
  duplicateOfTaskId,
  note,
  projectId,
  taskId,
  ...actor
}: Actor & {
  duplicateOfTaskId: string;
  note?: string;
  projectId: string;
  taskId: string;
}) {
  const [target] = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      number: taskTable.number,
      title: taskTable.title,
      archivedAt: taskTable.archivedAt,
      inTriage: sql<boolean>`${inTriageColumnSql}`,
      slug: projectTable.slug,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(eq(taskTable.id, duplicateOfTaskId))
    .limit(1);
  if (!target || target.projectId !== projectId) {
    throw new HTTPException(404, { message: TASK_NOT_FOUND });
  }
  if (target.id === taskId) {
    throw new HTTPException(400, { message: SELF_DUPLICATE });
  }
  if (target.archivedAt || target.inTriage) {
    throw new HTTPException(400, { message: DUPLICATE_NOT_VISIBLE });
  }

  const resolutionNote = normalizeNote(note);
  const { item, previousStatus } = await runIntakeTransition({
    itemId: actor.itemId,
    userId: actor.userId,
    action: "duplicate",
    input: { duplicateOfTaskId: target.id, note: resolutionNote },
  });
  await publishIntakeItemUpdated({
    item,
    workspaceId: actor.workspaceId,
    userId: actor.userId,
    action: "duplicate",
    previousStatus,
    extras: {
      note: resolutionNote,
      duplicateOfTaskId: target.id,
      duplicateKey: formatTaskKey(target.slug, target.number),
      duplicateTitle: target.title,
    },
  });
  return item;
}
