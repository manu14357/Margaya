import { eq } from "drizzle-orm";
import db from "../../database";
import { moduleMemberTable, moduleTable } from "../../database/schema";
import { publishEvent } from "../../events";
import type { Transaction } from "../queries";
import type { ModuleStatus } from "../types";
import {
  assertDateOrder,
  assertLead,
  assertMembers,
  assertNameAvailable,
  assertNotArchived,
  getModuleResponse,
  lockModule,
  type ModuleRecord,
  normalizeDescription,
  uniqueIds,
  withNameConflictMapped,
} from "./shared";

export type UpdateModuleInput = {
  name?: string;
  description?: string | null;
  status?: ModuleStatus;
  startDate?: string | null;
  targetDate?: string | null;
  leadId?: string | null;
  memberIds?: string[];
};

type ModuleValues = Partial<
  Pick<
    ModuleRecord,
    "name" | "description" | "status" | "startDate" | "targetDate" | "leadId"
  >
>;

function changedValues(
  current: ModuleRecord,
  input: UpdateModuleInput,
): ModuleValues {
  const next: ModuleValues = {
    name: input.name,
    description:
      input.description === undefined
        ? undefined
        : normalizeDescription(input.description),
    status: input.status,
    startDate: input.startDate,
    targetDate: input.targetDate,
    leadId: input.leadId,
  };
  const values: ModuleValues = {};
  for (const [key, value] of Object.entries(next) as Array<
    [keyof ModuleValues, ModuleValues[keyof ModuleValues]]
  >) {
    if (value !== undefined && value !== current[key]) {
      Object.assign(values, { [key]: value });
    }
  }
  return values;
}

/** Replaces the member set; true when it changed. */
async function replaceMembers(
  tx: Transaction,
  moduleId: string,
  memberIds: string[],
): Promise<boolean> {
  const current = await tx
    .select({ userId: moduleMemberTable.userId })
    .from(moduleMemberTable)
    .where(eq(moduleMemberTable.moduleId, moduleId));
  const currentIds = new Set(current.map((row) => row.userId));
  if (
    currentIds.size === memberIds.length &&
    memberIds.every((id) => currentIds.has(id))
  ) {
    return false;
  }

  await tx
    .delete(moduleMemberTable)
    .where(eq(moduleMemberTable.moduleId, moduleId));
  if (memberIds.length > 0) {
    await tx
      .insert(moduleMemberTable)
      .values(memberIds.map((userId) => ({ moduleId, userId })));
  }
  return true;
}

/**
 * Changes a module; omitted fields stay, null clears the description, the
 * dates and the lead, and `memberIds` replaces the members. Archived modules
 * can't change. A request that changes nothing publishes no event.
 */
async function updateModule({
  moduleId,
  workspaceId,
  userId,
  input,
}: {
  moduleId: string;
  workspaceId: string;
  userId: string;
  input: UpdateModuleInput;
}) {
  if (input.leadId) await assertLead(input.leadId, workspaceId);
  const memberIds =
    input.memberIds === undefined ? undefined : uniqueIds(input.memberIds);
  if (memberIds?.length) await assertMembers(memberIds, workspaceId);

  const { projectId, changes } = await withNameConflictMapped(() =>
    db.transaction(async (tx) => {
      const current = await lockModule(tx, moduleId);
      assertNotArchived(current);
      assertDateOrder(
        input.startDate === undefined ? current.startDate : input.startDate,
        input.targetDate === undefined ? current.targetDate : input.targetDate,
      );

      const values = changedValues(current, input);
      if (values.name !== undefined) {
        await assertNameAvailable(
          tx,
          current.projectId,
          values.name,
          current.id,
        );
      }

      const changes: string[] = Object.keys(values);
      if (changes.length > 0) {
        await tx
          .update(moduleTable)
          .set(values)
          .where(eq(moduleTable.id, moduleId));
      }
      if (memberIds && (await replaceMembers(tx, moduleId, memberIds))) {
        changes.push("memberIds");
        if (Object.keys(values).length === 0) {
          // Member changes alone still move the module's updatedAt.
          await tx
            .update(moduleTable)
            .set({ updatedAt: new Date() })
            .where(eq(moduleTable.id, moduleId));
        }
      }
      return { projectId: current.projectId, changes };
    }),
  );

  if (changes.length > 0) {
    await publishEvent("module.updated", {
      moduleId,
      projectId,
      userId,
      changes,
    });
  }

  return getModuleResponse(moduleId);
}

export default updateModule;
