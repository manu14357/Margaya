import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";
import { publishCycleChanges } from "../cycle/controllers/membership";
import type { CycleRecord } from "../cycle/controllers/shared";
import { moveUnfinishedTasks } from "../cycle/controllers/transfer-cycle-tasks";
import { deriveCycleStatus } from "../cycle/dates";
import { pendingScopeTaskIds } from "../cycle/queries";
import db from "../database";
import {
  cycleTable,
  projectAutomationTable,
  projectTable,
  workspaceTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { notifySystem } from "../notification/system";
import { withJobLease } from "../scheduler/leader-lock";
import { shiftDate, todayUtc } from "../utils/calendar-date";
import { resolveTimezone, todayInTimezone } from "../utils/zoned-date";

// Cycle auto-rollover (opt-in per project). Hourly, under a job lease: each
// cycle that ended (in its workspace's time zone) since the rule was turned
// on is handled once. Its unfinished tasks move to the project's next cycle,
// the one starting first after it ends, with one history row per task and
// the same events as a manual transfer; the project lead gets one summary.
// `cycle.rolled_over_at` is set in the same transaction as the move, under
// the cycle's row lock, so a second run (or a second instance) skips it.

export const CYCLE_ROLLOVER_LEASE = "cycle-rollover";
const LEASE_MS = 15 * 60 * 1000;
export const ROLLOVER_NOTIFICATION_TYPE = "cycle_rollover";

export type RolloverJobLimits = {
  /** Ended cycles handled per tick, earliest end first. */
  cycles: number;
  /** No new cycle starts after this many milliseconds. */
  budgetMs: number;
};

export const DEFAULT_ROLLOVER_LIMITS: RolloverJobLimits = {
  cycles: 200,
  budgetMs: 4 * 60 * 1000,
};

export type RolloverJobOutcome = {
  degraded: boolean;
  cycles: number;
  moved: number;
};

type RolloverOutcome = NonNullable<CycleRecord["rolloverResult"]>;

type Candidate = {
  cycleId: string;
  projectId: string;
  workspaceId: string;
  timezone: string;
  leadUserId: string | null;
  endDate: string;
};

/**
 * Cycles that may have ended: the rule is on, cycles are on, the project is
 * live, and the end date is before UTC tomorrow (no zone is further ahead).
 * The exact local "ended" check happens per cycle.
 */
async function loadCandidates(now: Date, limit: number): Promise<Candidate[]> {
  const rows = await db
    .select({
      cycleId: cycleTable.id,
      projectId: cycleTable.projectId,
      workspaceId: projectTable.workspaceId,
      timezone: workspaceTable.timezone,
      leadUserId: projectTable.leadUserId,
      endDate: cycleTable.endDate,
    })
    .from(cycleTable)
    .innerJoin(
      projectAutomationTable,
      eq(projectAutomationTable.projectId, cycleTable.projectId),
    )
    .innerJoin(projectTable, eq(projectTable.id, cycleTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        eq(projectAutomationTable.cycleRolloverEnabled, true),
        isNotNull(projectAutomationTable.cycleRolloverSince),
        eq(projectTable.cyclesEnabled, true),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(cycleTable.archivedAt),
        isNull(cycleTable.rolledOverAt),
        isNotNull(cycleTable.endDate),
        gte(cycleTable.endDate, projectAutomationTable.cycleRolloverSince),
        lt(cycleTable.endDate, shiftDate(todayUtc(now), 1)),
      ),
    )
    .orderBy(asc(cycleTable.endDate), asc(cycleTable.id))
    .limit(limit);

  return rows.flatMap((row) => {
    if (!row.endDate) return [];
    const timezone = resolveTimezone(row.timezone);
    // Ended means the end date is before the workspace's today.
    if (row.endDate >= todayInTimezone(timezone, now)) return [];
    return [{ ...row, endDate: row.endDate, timezone }];
  });
}

/** The project's next cycle: the first one starting after `endDate`. */
async function findNextCycle(
  source: Pick<CycleRecord, "id" | "projectId" | "endDate">,
  today: string,
) {
  if (!source.endDate) return null;
  const [next] = await db
    .select({ id: cycleTable.id })
    .from(cycleTable)
    .where(
      and(
        eq(cycleTable.projectId, source.projectId),
        ne(cycleTable.id, source.id),
        isNull(cycleTable.archivedAt),
        gt(cycleTable.startDate, source.endDate),
        gte(cycleTable.endDate, today),
      ),
    )
    .orderBy(
      asc(cycleTable.startDate),
      asc(cycleTable.sortOrder),
      asc(cycleTable.id),
    )
    .limit(1);
  return next?.id ?? null;
}

type RolledCycle = {
  source: CycleRecord;
  result: RolloverOutcome;
  frozeNow: boolean;
  changes: Awaited<ReturnType<typeof moveUnfinishedTasks>>["changes"];
  /** Unfinished tasks left behind because there was no next cycle. */
  stranded: number;
};

/**
 * Rolls one cycle over in one transaction. Null when another run handled it
 * first or it no longer qualifies (the next tick looks again).
 */
async function rollCycle(
  candidate: Candidate,
  now: Date,
): Promise<RolledCycle | null> {
  const today = todayInTimezone(candidate.timezone, now);
  const targetId = await findNextCycle(
    {
      id: candidate.cycleId,
      projectId: candidate.projectId,
      endDate: candidate.endDate,
    },
    today,
  );

  return db.transaction(async (tx) => {
    // Both rows in id order, like a manual transfer, so the two can't
    // deadlock.
    const ids = targetId ? [candidate.cycleId, targetId] : [candidate.cycleId];
    const locked = await tx
      .select()
      .from(cycleTable)
      .where(inArray(cycleTable.id, ids))
      .orderBy(asc(cycleTable.id))
      .for("update");
    const source = locked.find((cycle) => cycle.id === candidate.cycleId);
    if (
      !source ||
      source.rolledOverAt ||
      source.archivedAt ||
      deriveCycleStatus(source, today) !== "completed"
    ) {
      return null;
    }
    // The rule may have been turned off since the candidates were read.
    const [rule] = await tx
      .select({ enabled: projectAutomationTable.cycleRolloverEnabled })
      .from(projectAutomationTable)
      .where(eq(projectAutomationTable.projectId, source.projectId))
      .limit(1);
    if (!rule?.enabled) return null;

    const target = targetId
      ? locked.find((cycle) => cycle.id === targetId)
      : undefined;
    if (
      targetId &&
      (!target ||
        target.archivedAt ||
        deriveCycleStatus(target, today) === "completed")
    ) {
      // The target changed under us; look again next tick.
      return null;
    }

    let result: RolloverOutcome;
    let frozeNow = false;
    let changes: RolledCycle["changes"] = [];
    let stranded = 0;
    if (target) {
      ({ frozeNow, changes } = await moveUnfinishedTasks(tx, {
        source,
        target,
        workspaceId: candidate.workspaceId,
        today,
        userId: null,
      }));
      result = {
        outcome: changes.length > 0 ? "moved" : "nothing_to_move",
        movedCount: changes.length,
        targetCycleId: target.id,
        targetCycleName: target.name,
      };
    } else {
      stranded = (await pendingScopeTaskIds(tx, source.id)).length;
      result = {
        outcome: "no_next_cycle",
        movedCount: 0,
        targetCycleId: null,
        targetCycleName: null,
      };
    }

    await tx
      .update(cycleTable)
      .set({ rolledOverAt: now, rolloverResult: result })
      .where(eq(cycleTable.id, source.id));
    if (changes.length > 0) {
      await tx
        .update(projectAutomationTable)
        .set({
          lastRolledOverAt: now,
          lastRolledOverCount: changes.length,
          // Settings did not change; keep their timestamp.
          updatedAt: sql`${projectAutomationTable.updatedAt}`,
        })
        .where(eq(projectAutomationTable.projectId, source.projectId));
    }
    return { source, result, frozeNow, changes, stranded };
  });
}

/** One summary for the project lead, only when there is something to say. */
async function notifyLead(candidate: Candidate, rolled: RolledCycle) {
  if (!candidate.leadUserId) return;
  if (rolled.changes.length === 0 && rolled.stranded === 0) return;
  const [project] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, candidate.projectId))
    .limit(1);
  const moved = rolled.result.outcome === "moved";
  await notifySystem({
    userId: candidate.leadUserId,
    type: ROLLOVER_NOTIFICATION_TYPE,
    // English fallbacks; the web renders the type with its own strings.
    title: moved ? "Cycle rolled over" : "Cycle ended with unfinished tasks",
    content: moved
      ? `${rolled.changes.length} unfinished tasks moved from ${rolled.source.name} to ${rolled.result.targetCycleName}.`
      : `${rolled.stranded} unfinished tasks stayed in ${rolled.source.name}: there is no next cycle.`,
    eventData: {
      projectId: candidate.projectId,
      projectName: project?.name ?? null,
      cycleId: rolled.source.id,
      cycleName: rolled.source.name,
      targetCycleId: rolled.result.targetCycleId,
      targetCycleName: rolled.result.targetCycleName,
      outcome: rolled.result.outcome,
      count: moved ? rolled.changes.length : rolled.stranded,
    },
    resourceId: candidate.workspaceId,
    resourceType: "workspace",
  });
}

async function runOnce(
  now: Date,
  limits: RolloverJobLimits,
): Promise<RolloverJobOutcome> {
  const startedAt = Date.now();
  const outcome: RolloverJobOutcome = { degraded: false, cycles: 0, moved: 0 };

  for (const candidate of await loadCandidates(now, limits.cycles)) {
    if (Date.now() - startedAt >= limits.budgetMs) break;
    try {
      const rolled = await rollCycle(candidate, now);
      if (!rolled) continue;
      outcome.cycles += 1;
      outcome.moved += rolled.changes.length;

      // The cycle's rollover note changed, and its report may have frozen.
      await publishEvent("cycle.updated", {
        cycleId: rolled.source.id,
        projectId: candidate.projectId,
        userId: null,
        changes: rolled.frozeNow
          ? ["progressSnapshot", "rollover"]
          : ["rollover"],
      });
      await publishCycleChanges({
        projectId: candidate.projectId,
        userId: null,
        changes: rolled.changes,
      });
      await notifyLead(candidate, rolled);
    } catch (error) {
      // Ids only: names and task content never reach the logs.
      console.error(`cycle rollover: cycle ${candidate.cycleId} failed`, error);
      outcome.degraded = true;
    }
  }

  if (outcome.cycles > 0) {
    console.log(
      `cycle rollover: handled ${outcome.cycles} ended cycles, moved ${outcome.moved} tasks`,
    );
  }
  return outcome;
}

/** The scheduler entry: one bounded pass, on one API instance at a time. */
export async function runCycleRollover(
  now: Date = new Date(),
  limits: RolloverJobLimits = DEFAULT_ROLLOVER_LIMITS,
): Promise<RolloverJobOutcome> {
  return withJobLease(
    CYCLE_ROLLOVER_LEASE,
    () => runOnce(now, limits),
    () => ({ degraded: false, cycles: 0, moved: 0 }),
    LEASE_MS,
  );
}
