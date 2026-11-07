import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { pageTable } from "../../database/schema";
import { canSeePage, PAGE_MESSAGES, type PageCaller } from "../rules";
import type { PageRecord, Transaction } from "./shared";

/**
 * T1: the new parent exists in the workspace and is visible (404), is in
 * `projectId` (400) and is not archived (409, checked by the caller after
 * the cycle check where it applies).
 */
export async function loadParentPage(
  tx: Transaction,
  {
    parentId,
    workspaceId,
    projectId,
    caller,
  }: {
    parentId: string;
    workspaceId: string;
    projectId: string;
    caller: PageCaller;
  },
): Promise<PageRecord> {
  const [parent] = await tx
    .select()
    .from(pageTable)
    .where(eq(pageTable.id, parentId))
    .limit(1);
  if (
    !parent ||
    parent.deletedAt ||
    parent.workspaceId !== workspaceId ||
    !canSeePage(parent, caller)
  ) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.parentNotFound });
  }
  if (parent.projectId !== projectId) {
    throw new HTTPException(400, { message: PAGE_MESSAGES.parentOtherProject });
  }
  return parent;
}

export function assertParentNotArchived(parent: PageRecord) {
  if (parent.archivedAt !== null) {
    throw new HTTPException(409, { message: PAGE_MESSAGES.parentArchived });
  }
}
