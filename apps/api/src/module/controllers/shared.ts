import { and, eq, getTableColumns, ne, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { moduleTable, userTable } from "../../database/schema";
import {
  EMPTY_COUNTS,
  type GroupCounts,
  pendingOf,
  progressOf,
} from "../../task/progress";
import { filterAssignableUsers } from "../../utils/assert-assignable-user";
import {
  countsByModule,
  memberIdsByModule,
  type Reader,
  type Transaction,
} from "../queries";

export type ModuleRecord = typeof moduleTable.$inferSelect;

export type ModuleRow = ModuleRecord & {
  lead: { id: string; name: string; image: string | null } | null;
};

export const MODULE_NOT_FOUND = "Module not found";
export const RESTORE_BEFORE_EDITING = "Restore the module before editing it";
export const NAME_TAKEN = "A module with this name already exists";

// pg_advisory_xact_lock class for per-project module ordering (create and
// reorder). Project ordering uses 1524 and favorites 1525.
const MODULE_ORDER_LOCK = 1526;

/** Modules matching `where`, each with its lead's display fields. */
export async function selectModules(
  reader: Reader,
  where: SQL | undefined,
  orderBy: SQL[] = [],
  limit?: number,
): Promise<ModuleRow[]> {
  const query = reader
    .select({
      ...getTableColumns(moduleTable),
      leadUserId: userTable.id,
      leadName: userTable.name,
      leadImage: userTable.image,
    })
    .from(moduleTable)
    .leftJoin(userTable, eq(userTable.id, moduleTable.leadId))
    .where(where)
    .orderBy(...orderBy);
  const rows = await (limit === undefined ? query : query.limit(limit));

  return rows.map(({ leadUserId, leadName, leadImage, ...row }) => ({
    ...row,
    lead:
      leadUserId && leadName !== null
        ? { id: leadUserId, name: leadName, image: leadImage }
        : null,
  }));
}

export async function requireModule(
  reader: Reader,
  moduleId: string,
): Promise<ModuleRecord> {
  const [found] = await reader
    .select()
    .from(moduleTable)
    .where(eq(moduleTable.id, moduleId))
    .limit(1);
  if (!found) throw new HTTPException(404, { message: MODULE_NOT_FOUND });
  return found;
}

/** Reads the module row with FOR UPDATE, serializing writes to it. */
export async function lockModule(
  tx: Transaction,
  moduleId: string,
): Promise<ModuleRecord> {
  const [found] = await tx
    .select()
    .from(moduleTable)
    .where(eq(moduleTable.id, moduleId))
    .for("update");
  if (!found) throw new HTTPException(404, { message: MODULE_NOT_FOUND });
  return found;
}

/** Serializes the writes that depend on the project's module ordering. */
export async function lockProjectModules(tx: Transaction, projectId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${MODULE_ORDER_LOCK}, hashtext(${projectId}))`,
  );
}

/** Archived modules are read-only: no edits, memberships or links. */
export function assertNotArchived(found: Pick<ModuleRecord, "archivedAt">) {
  if (found.archivedAt) {
    throw new HTTPException(409, { message: RESTORE_BEFORE_EDITING });
  }
}

/** Names are unique per project, ignoring case, archived modules included. */
export async function assertNameAvailable(
  reader: Reader,
  projectId: string,
  name: string,
  exceptModuleId?: string,
) {
  const [conflict] = await reader
    .select({ id: moduleTable.id })
    .from(moduleTable)
    .where(
      and(
        eq(moduleTable.projectId, projectId),
        sql`lower(${moduleTable.name}) = lower(${name})`,
        exceptModuleId ? ne(moduleTable.id, exceptModuleId) : undefined,
      ),
    )
    .limit(1);
  if (conflict) throw new HTTPException(409, { message: NAME_TAKEN });
}

/** True for a Postgres unique violation of the given constraint or index. */
export function isUniqueViolation(error: unknown, constraint: string) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === constraint
  );
}

/** Runs a write, turning a lost race on the name index into the usual 409. */
export async function withNameConflictMapped<T>(
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, "module_project_name_unique")) {
      throw new HTTPException(409, { message: NAME_TAKEN });
    }
    throw error;
  }
}

export async function assertLead(leadId: string, workspaceId: string) {
  const assignable = await filterAssignableUsers([leadId], workspaceId);
  if (!assignable.has(leadId)) {
    throw new HTTPException(400, {
      message: "Lead must be a member of this workspace",
    });
  }
}

export async function assertMembers(userIds: string[], workspaceId: string) {
  const assignable = await filterAssignableUsers(userIds, workspaceId);
  if (userIds.some((id) => !assignable.has(id))) {
    throw new HTTPException(400, {
      message: "Members must belong to this workspace",
    });
  }
}

/** Start ≤ target whenever both dates are set. */
export function assertDateOrder(
  startDate: string | null,
  targetDate: string | null,
) {
  if (startDate && targetDate && startDate > targetDate) {
    throw new HTTPException(400, {
      message: "Start date cannot be after target date",
    });
  }
}

/** Plain text; empty or whitespace-only descriptions are stored as null. */
export function normalizeDescription(value: string | null): string | null {
  return value === null || value.trim() === "" ? null : value;
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function toModule(
  row: ModuleRow,
  counts: GroupCounts | undefined,
  memberIds: string[],
) {
  const resolved = counts ?? EMPTY_COUNTS;
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    status: row.status,
    startDate: row.startDate,
    targetDate: row.targetDate,
    leadId: row.leadId,
    lead: row.lead,
    memberIds,
    position: row.position,
    archivedAt: row.archivedAt,
    counts: resolved,
    pending: pendingOf(resolved),
    progress: progressOf(resolved),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ModuleResponse = ReturnType<typeof toModule>;

export async function getModuleResponse(
  moduleId: string,
  reader: Reader = db,
): Promise<ModuleResponse> {
  const [row] = await selectModules(reader, eq(moduleTable.id, moduleId));
  if (!row) throw new HTTPException(404, { message: MODULE_NOT_FOUND });
  const counts = await countsByModule(reader, eq(moduleTable.id, moduleId));
  const members = await memberIdsByModule(reader, [moduleId]);
  return toModule(row, counts.get(moduleId), members.get(moduleId) ?? []);
}
