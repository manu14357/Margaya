import { eq, min } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleMemberTable, moduleTable } from "../../database/schema";
import { publishEvent } from "../../events";
import type { ModuleStatus } from "../types";
import {
  assertDateOrder,
  assertLead,
  assertMembers,
  assertNameAvailable,
  getModuleResponse,
  lockProjectModules,
  normalizeDescription,
  uniqueIds,
  withNameConflictMapped,
} from "./shared";

export type CreateModuleInput = {
  name: string;
  description?: string | null;
  status?: ModuleStatus;
  startDate?: string | null;
  targetDate?: string | null;
  leadId?: string | null;
  memberIds?: string[];
};

/** Creates a module at the top of the project's manual order. */
async function createModule({
  projectId,
  workspaceId,
  userId,
  input,
}: {
  projectId: string;
  workspaceId: string;
  userId: string;
  input: CreateModuleInput;
}) {
  const startDate = input.startDate ?? null;
  const targetDate = input.targetDate ?? null;
  assertDateOrder(startDate, targetDate);
  if (input.leadId) await assertLead(input.leadId, workspaceId);
  const memberIds = uniqueIds(input.memberIds ?? []);
  if (memberIds.length > 0) await assertMembers(memberIds, workspaceId);

  const created = await withNameConflictMapped(() =>
    db.transaction(async (tx) => {
      await lockProjectModules(tx, projectId);
      await assertNameAvailable(tx, projectId, input.name);

      const [top] = await tx
        .select({ position: min(moduleTable.position) })
        .from(moduleTable)
        .where(eq(moduleTable.projectId, projectId));

      const [row] = await tx
        .insert(moduleTable)
        .values({
          projectId,
          name: input.name,
          description: normalizeDescription(input.description ?? null),
          status: input.status ?? "backlog",
          startDate,
          targetDate,
          leadId: input.leadId ?? null,
          position: (top?.position ?? 1) - 1,
          createdBy: userId,
        })
        .returning();
      if (!row) {
        throw new HTTPException(500, {
          message: "Failed to create the module",
        });
      }

      if (memberIds.length > 0) {
        await tx
          .insert(moduleMemberTable)
          .values(memberIds.map((id) => ({ moduleId: row.id, userId: id })));
      }
      return row;
    }),
  );

  await publishEvent("module.created", {
    moduleId: created.id,
    projectId,
    userId,
    name: created.name,
  });

  return getModuleResponse(created.id);
}

export default createModule;
