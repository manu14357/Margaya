import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { intakeItemTable } from "../../database/schema";
import { REQUEST_NOT_FOUND } from "../access";
import { effectiveStatusSql, loadIntakeItem } from "../queries";
import {
  assertTransition,
  type IntakeAction,
  type IntakeStatus,
  isIntakeStatus,
  transitionFields,
} from "../status";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function requireIntakeItem(id: string) {
  const item = await loadIntakeItem(id);
  if (!item) throw new HTTPException(404, { message: REQUEST_NOT_FOUND });
  return item;
}

/**
 * Locks the request row for the rest of the transaction and reads its
 * effective status after the lock, so of two racing triagers one succeeds
 * and the other gets the 409 of the state the first one left.
 */
export async function lockIntakeItem(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      id: intakeItemTable.id,
      projectId: intakeItemTable.projectId,
      taskId: intakeItemTable.taskId,
      status: effectiveStatusSql,
    })
    .from(intakeItemTable)
    .where(eq(intakeItemTable.id, id))
    .for("update");
  if (!row) throw new HTTPException(404, { message: REQUEST_NOT_FOUND });
  const status: IntakeStatus = isIntakeStatus(row.status)
    ? row.status
    : "pending";
  return { ...row, status };
}

/** The UPDATE values of a triage decision by `userId`. */
export function triageUpdate(
  action: IntakeAction,
  userId: string,
  input: Parameters<typeof transitionFields>[1] = {},
) {
  return {
    ...transitionFields(action, input),
    triagedBy: userId,
    triagedAt: new Date(),
  };
}

/**
 * Runs one of the simple transitions (everything but accept, which also
 * moves the task) and returns the item as it is afterwards together with the
 * effective status it had before.
 */
export async function runIntakeTransition({
  itemId,
  userId,
  action,
  input,
}: {
  itemId: string;
  userId: string;
  action: Exclude<IntakeAction, "accept">;
  input?: Parameters<typeof transitionFields>[1];
}) {
  const previousStatus = await db.transaction(async (tx) => {
    const locked = await lockIntakeItem(tx, itemId);
    assertTransition(locked.status, action);
    await tx
      .update(intakeItemTable)
      .set(triageUpdate(action, userId, input))
      .where(eq(intakeItemTable.id, itemId));
    return locked.status;
  });
  return { item: await requireIntakeItem(itemId), previousStatus };
}
