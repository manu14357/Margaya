import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleTable } from "../../database/schema";
import { publishEvent } from "../../events";
import listModules, { MODULE_ORDER } from "./list-modules";
import { lockProjectModules } from "./shared";

/**
 * Applies a manual order, like project reorder: the payload only expresses a
 * relative order, modules it omits (archived ones included) keep their rank,
 * and the project's modules are renumbered to 0..n-1.
 */
async function reorderModules({
  projectId,
  userId,
  modules,
}: {
  projectId: string;
  userId: string;
  modules: Array<{ id: string; position: number }>;
}) {
  const ids = modules.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new HTTPException(400, {
      message: "Duplicate module ids in reorder payload",
    });
  }

  const changed = await db.transaction(async (tx) => {
    await lockProjectModules(tx, projectId);

    const existing = await tx
      .select({ id: moduleTable.id, position: moduleTable.position })
      .from(moduleTable)
      .where(eq(moduleTable.projectId, projectId))
      .orderBy(...MODULE_ORDER);

    // Check the whole batch before writing, so a foreign id can't leave the
    // project half-renumbered.
    const ownedIds = new Set(existing.map((row) => row.id));
    const foreignId = ids.find((id) => !ownedIds.has(id));
    if (foreignId) {
      throw new HTTPException(400, {
        message: `Module ${foreignId} does not belong to this project`,
      });
    }

    const requestedOrder = [...modules]
      .sort((a, b) => a.position - b.position)
      .map((entry) => entry.id);
    const requestedIds = new Set(requestedOrder);
    const requested = requestedOrder[Symbol.iterator]();
    const finalOrder = existing.map((row) =>
      requestedIds.has(row.id) ? (requested.next().value ?? row.id) : row.id,
    );

    const currentPositions = new Map(
      existing.map((row) => [row.id, row.position]),
    );
    let changed = false;
    for (const [position, id] of finalOrder.entries()) {
      if (currentPositions.get(id) === position) continue;
      await tx
        .update(moduleTable)
        .set({ position })
        .where(eq(moduleTable.id, id));
      changed = true;
    }
    return changed;
  });

  if (changed) {
    await publishEvent("module.reordered", { projectId, userId });
  }

  return listModules(projectId, { view: "active" });
}

export default reorderModules;
