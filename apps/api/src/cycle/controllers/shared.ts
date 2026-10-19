import { eq, getTableColumns, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  cycleTable,
  cycleTaskTable,
  projectTable,
  userTable,
} from "../../database/schema";
import { getScopeEstimates } from "../../estimate/totals";
import {
  EMPTY_COUNTS,
  type GroupCounts,
  type ProgressReport,
  pendingOf,
  progressOf,
} from "../../task/progress";
import { reportFromScope } from "../../task/progress-queries";
import { filterAssignableUsers } from "../../utils/assert-assignable-user";
import { daySpan } from "../../utils/calendar-date";
import { projectToday } from "../../utils/timezone";
import { deriveCycleStatus, MAX_CYCLE_SPAN_DAYS } from "../dates";
import {
  countsByCycle,
  type Reader,
  scopeTaskLabels,
  scopeTasks,
  type Transaction,
} from "../queries";

export type CycleRecord = typeof cycleTable.$inferSelect;

export type CycleRow = CycleRecord & {
  owner: { id: string; name: string; image: string | null } | null;
};

export const CYCLE_NOT_FOUND = "Cycle not found";

/** Cycles matching `where`, each with its owner's display fields. */
export async function selectCycles(
  reader: Reader,
  where: SQL | undefined,
): Promise<CycleRow[]> {
  const rows = await reader
    .select({
      ...getTableColumns(cycleTable),
      ownerUserId: userTable.id,
      ownerName: userTable.name,
      ownerImage: userTable.image,
    })
    .from(cycleTable)
    .leftJoin(userTable, eq(userTable.id, cycleTable.ownerId))
    .where(where);

  return rows.map(({ ownerUserId, ownerName, ownerImage, ...cycle }) => ({
    ...cycle,
    owner:
      ownerUserId && ownerName !== null
        ? { id: ownerUserId, name: ownerName, image: ownerImage }
        : null,
  }));
}

export async function requireCycle(
  reader: Reader,
  cycleId: string,
): Promise<CycleRecord> {
  const [cycle] = await reader
    .select()
    .from(cycleTable)
    .where(eq(cycleTable.id, cycleId))
    .limit(1);
  if (!cycle) throw new HTTPException(404, { message: CYCLE_NOT_FOUND });
  return cycle;
}

/** Reads the cycle row with FOR UPDATE, serializing writes to it. */
export async function lockCycle(
  tx: Transaction,
  cycleId: string,
): Promise<CycleRecord> {
  const [cycle] = await tx
    .select()
    .from(cycleTable)
    .where(eq(cycleTable.id, cycleId))
    .for("update");
  if (!cycle) throw new HTTPException(404, { message: CYCLE_NOT_FOUND });
  return cycle;
}

/**
 * Locks the project row. Cycle date writes take this lock first, so the
 * overlap check and the write cannot interleave with another one.
 */
export async function lockProject(tx: Transaction, projectId: string) {
  const [project] = await tx
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .for("update");
  if (!project) throw new HTTPException(404, { message: "Project not found" });
}

export function toCycle(
  row: CycleRow,
  liveCounts: GroupCounts | undefined,
  today: string,
) {
  const snapshot = row.progressSnapshot;
  const counts = snapshot?.counts ?? liveCounts ?? EMPTY_COUNTS;

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    ownerId: row.ownerId,
    owner: row.owner,
    sortOrder: row.sortOrder,
    status: deriveCycleStatus(row, today),
    today,
    archivedAt: row.archivedAt,
    isFrozen: snapshot !== null,
    counts,
    pending: snapshot ? snapshot.pending : pendingOf(counts),
    progress: snapshot ? snapshot.progress : progressOf(counts),
    rollover:
      row.rolledOverAt && row.rolloverResult
        ? { at: row.rolledOverAt, ...row.rolloverResult }
        : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CycleResponse = ReturnType<typeof toCycle>;

export async function getCycleResponse(
  cycleId: string,
  reader: Reader = db,
): Promise<CycleResponse> {
  const [row] = await selectCycles(reader, eq(cycleTable.id, cycleId));
  if (!row) throw new HTTPException(404, { message: CYCLE_NOT_FOUND });
  const counts = await countsByCycle(reader, eq(cycleTable.id, cycleId));
  return toCycle(
    row,
    counts.get(cycleId),
    await projectToday(row.projectId, reader),
  );
}

/**
 * The live progress report over the cycle's current scope, estimate totals
 * and the points chart included.
 */
export async function computeLiveReport(
  reader: Reader,
  cycle: Pick<CycleRecord, "id" | "projectId" | "startDate" | "endDate">,
  workspaceId: string,
  today: string,
): Promise<ProgressReport> {
  const { estimates, estimateValues } = await getScopeEstimates(
    reader,
    cycle.projectId,
    {
      kind: "subquery",
      sql: sql`select ${cycleTaskTable.taskId} from ${cycleTaskTable} where ${cycleTaskTable.cycleId} = ${cycle.id}`,
    },
  );
  return reportFromScope(reader, {
    workspaceId,
    tasks: await scopeTasks(reader, cycle.id),
    labels: await scopeTaskLabels(reader, cycle.id),
    startDate: cycle.startDate,
    endDate: cycle.endDate,
    today,
    estimates,
    estimateValues,
  });
}

export const DATES_TOGETHER = "Send startDate and endDate together";

type DateInput = string | null | undefined;
export type DatePair = { startDate: string | null; endDate: string | null };

/**
 * The dates a write sets: undefined when neither key was sent, otherwise
 * both set (a valid range) or both null (a draft). Anything else is a 400.
 */
export function resolveDatePair(
  startDate: DateInput,
  endDate: DateInput,
): DatePair | undefined {
  if (startDate === undefined && endDate === undefined) return undefined;
  if (startDate === undefined || endDate === undefined) {
    throw new HTTPException(400, { message: DATES_TOGETHER });
  }
  if (startDate === null && endDate === null) {
    return { startDate: null, endDate: null };
  }
  if (startDate === null || endDate === null) {
    throw new HTTPException(400, { message: DATES_TOGETHER });
  }
  if (startDate > endDate) {
    throw new HTTPException(400, {
      message: "Start date can't be after the end date",
    });
  }
  if (daySpan(startDate, endDate) > MAX_CYCLE_SPAN_DAYS) {
    throw new HTTPException(400, {
      message: "A cycle can span at most 366 days",
    });
  }
  return { startDate, endDate };
}

export const OVERLAP_MESSAGE =
  "Another cycle already covers some of these dates";

export async function assertOwner(ownerId: string, workspaceId: string) {
  const assignable = await filterAssignableUsers([ownerId], workspaceId);
  if (!assignable.has(ownerId)) {
    throw new HTTPException(400, {
      message: "Owner must be a member of this workspace",
    });
  }
}

/** Only draft, upcoming and current cycles that are not archived take tasks. */
export function assertCanReceiveTasks(cycle: CycleRecord, today: string) {
  if (cycle.archivedAt) {
    throw new HTTPException(409, {
      message: "Archived cycles can't receive tasks",
    });
  }
  if (deriveCycleStatus(cycle, today) === "completed") {
    throw new HTTPException(409, {
      message: "Completed cycles can't receive tasks",
    });
  }
}

export function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
