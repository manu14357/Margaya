import { and, count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskDraftTable } from "../../database/schema";
import {
  LOCK_NAMESPACE,
  lockUserWorkspaceList,
} from "../../utils/user-workspace-lock";
import { applyDraftChanges, EMPTY_DRAFT, parseDraftPatch } from "../normalize";
import { TASK_DRAFTS_LIMIT, type TaskDraftPatch } from "../schema";
import { validateDraftChanges } from "../validate";
import {
  DRAFT_NOT_FOUND,
  type DraftRow,
  draftResponse,
  draftValuesOf,
  ownDrafts,
  publishDraftChanged,
} from "./shared";

export const NOTHING_TO_CHANGE = "Provide at least one field to change";

/** A new draft of the caller, up to 1,000 per workspace. */
export async function createTaskDraft({
  userId,
  workspaceId,
  patch,
}: {
  userId: string;
  workspaceId: string;
  patch: TaskDraftPatch;
}) {
  const changes = parseDraftPatch(patch);
  const { next } = applyDraftChanges(EMPTY_DRAFT, changes);
  await validateDraftChanges({ workspaceId, changes, next });

  const row = await db.transaction(async (tx) => {
    await lockUserWorkspaceList(
      tx,
      LOCK_NAMESPACE.taskDraft,
      userId,
      workspaceId,
    );
    const [existing] = await tx
      .select({ value: count() })
      .from(taskDraftTable)
      .where(ownDrafts(userId, workspaceId));
    if ((existing?.value ?? 0) >= TASK_DRAFTS_LIMIT) {
      throw new HTTPException(409, {
        message: `You can have up to ${TASK_DRAFTS_LIMIT.toLocaleString("en-US")} drafts in this workspace`,
      });
    }

    const [inserted] = await tx
      .insert(taskDraftTable)
      .values({ ...next, workspaceId, createdBy: userId })
      .returning();
    if (!inserted) {
      throw new HTTPException(500, { message: "Failed to create the draft" });
    }
    return inserted;
  });

  await publishDraftChanged(userId, workspaceId, row.id, "created");
  return draftResponse(row);
}

/**
 * Applies a patch to the caller's draft under a row lock. Answers the
 * stored draft; `changed` is false when every sent value was already
 * stored, and then nothing is written or published.
 */
export async function applyTaskDraftPatch({
  draftId,
  userId,
  patch,
}: {
  draftId: string;
  userId: string;
  patch: TaskDraftPatch;
}): Promise<{ row: DraftRow; changed: boolean }> {
  const changes = parseDraftPatch(patch);
  if (Object.keys(changes).length === 0) {
    throw new HTTPException(400, { message: NOTHING_TO_CHANGE });
  }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(taskDraftTable)
      .where(
        and(
          eq(taskDraftTable.id, draftId),
          eq(taskDraftTable.createdBy, userId),
        ),
      )
      .for("update");
    if (!current) throw new HTTPException(404, { message: DRAFT_NOT_FOUND });

    const { next, changed } = applyDraftChanges(
      draftValuesOf(current),
      changes,
    );
    await validateDraftChanges({
      workspaceId: current.workspaceId,
      changes,
      next,
    });
    if (changed.length === 0) return { row: current, changed: false };

    const [updated] = await tx
      .update(taskDraftTable)
      .set(next)
      .where(eq(taskDraftTable.id, draftId))
      .returning();
    if (!updated) throw new HTTPException(404, { message: DRAFT_NOT_FOUND });
    return { row: updated, changed: true };
  });

  if (result.changed) {
    await publishDraftChanged(
      userId,
      result.row.workspaceId,
      draftId,
      "updated",
    );
  }
  return result;
}

export async function updateTaskDraft(input: {
  draftId: string;
  userId: string;
  patch: TaskDraftPatch;
}) {
  const { row } = await applyTaskDraftPatch(input);
  return draftResponse(row);
}

export async function deleteTaskDraft(draftId: string, userId: string) {
  const [deleted] = await db
    .delete(taskDraftTable)
    .where(
      and(eq(taskDraftTable.id, draftId), eq(taskDraftTable.createdBy, userId)),
    )
    .returning({
      id: taskDraftTable.id,
      workspaceId: taskDraftTable.workspaceId,
    });
  if (!deleted) throw new HTTPException(404, { message: DRAFT_NOT_FOUND });

  await publishDraftChanged(userId, deleted.workspaceId, deleted.id, "deleted");
  return { id: deleted.id };
}
