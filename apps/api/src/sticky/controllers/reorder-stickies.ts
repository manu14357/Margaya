import { and, inArray, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stickyTable } from "../../database/schema";
import { mergeRequestedOrder } from "../../favorite/ordering";
import {
  LOCK_NAMESPACE,
  lockUserWorkspaceList,
} from "../../utils/user-workspace-lock";
import { ownStickies, publishStickyChanged, stickyOrder } from "./shared";

/**
 * Moves the requested stickies into the given relative order. Stickies left
 * out (for example, not loaded yet) keep their rank, and the whole list is
 * renumbered to 0..n-1 with one UPDATE of the rows whose position changes.
 */
async function reorderStickies(
  userId: string,
  workspaceId: string,
  stickyIds: string[],
) {
  const reordered = await db.transaction(async (tx) => {
    await lockUserWorkspaceList(tx, LOCK_NAMESPACE.sticky, userId, workspaceId);

    const existing = await tx
      .select({ id: stickyTable.id, position: stickyTable.position })
      .from(stickyTable)
      .where(ownStickies(userId, workspaceId))
      .orderBy(...stickyOrder);

    // Check the whole batch first, so a foreign id writes nothing.
    const ownedIds = new Set(existing.map((sticky) => sticky.id));
    const foreignId = stickyIds.find((id) => !ownedIds.has(id));
    if (foreignId) {
      throw new HTTPException(400, {
        message: `Sticky ${foreignId} does not belong to you`,
      });
    }

    const currentPositions = new Map(
      existing.map((sticky) => [sticky.id, sticky.position]),
    );
    const moves = mergeRequestedOrder(
      existing.map((sticky) => sticky.id),
      stickyIds,
    ).flatMap((id, position) =>
      currentPositions.get(id) === position ? [] : [{ id, position }],
    );
    if (moves.length === 0) return 0;

    const cases: SQL[] = moves.map(
      ({ id, position }) => sql`when ${id} then ${position}::integer`,
    );
    await tx
      .update(stickyTable)
      .set({
        position: sql`case ${stickyTable.id} ${sql.join(cases, sql` `)} end`,
      })
      .where(
        and(
          ownStickies(userId, workspaceId),
          inArray(
            stickyTable.id,
            moves.map((move) => move.id),
          ),
        ),
      );
    return moves.length;
  });

  if (reordered > 0) {
    await publishStickyChanged(userId, workspaceId, null, "reordered");
  }
  return { reordered };
}

export default reorderStickies;
