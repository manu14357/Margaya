import { and, eq, gte, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { deriveCycleStatus } from "../../cycle/dates";
import type { CycleStatus } from "../../cycle/types";
import {
  columnTable,
  cycleTable,
  cycleTaskTable,
  taskTable,
} from "../../database/schema";
import { taskColumnJoin, visibleTaskCondition } from "../../task/scope";
import { textArray } from "../../task-query/context";
import { shiftDate } from "../../utils/calendar-date";
import { round2 } from "../metrics";
import type {
  AnalyticsCycleRow,
  AnalyticsCycles,
  AnalyticsVelocityPoint,
} from "../response";
import {
  type AnalyticsCaller,
  analyticsRead,
  loadAnalyticsContext,
  projectRank,
  projectsMeta,
  projectsWithFeature,
} from "../scope";
import {
  EMPTY_TALLY,
  hasPointsSystemSql,
  livePoints,
  NO_POINTS,
  type PlanningPoints,
  type PlanningTally,
  planningNumbers,
  planningTallyColumns,
  toPlanningTally,
} from "./planning";

// The cycles tab (AN4, B8 §2A.8): three statements. Counts follow the cycle
// progress route (members in the cycle's own project, visible scope, B1
// groups); a cycle frozen by a transfer reports its snapshot. "Today" is the
// server's UTC date (D2).

export const RECENT_COMPLETED_DAYS = 180;
export const MAX_CYCLE_ROWS = 300;
export const VELOCITY_CYCLES = 12;
export const AVERAGE_OVER = 3;

const STATUS_RANK: Record<CycleStatus, number> = {
  current: 0,
  upcoming: 1,
  draft: 2,
  completed: 3,
};

type CycleRecord = {
  id: string;
  projectId: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  createdAt: Date;
  archivedAt: Date | null;
  progressSnapshot: typeof cycleTable.$inferSelect.progressSnapshot;
  hasPointsSystem: boolean;
};

type RankedCycle = CycleRecord & { status: CycleStatus; rank: number };

/** B2's list order inside a status. */
function compareWithinStatus(a: RankedCycle, b: RankedCycle): number {
  switch (a.status) {
    case "current":
    case "upcoming":
      return (a.startDate ?? "").localeCompare(b.startDate ?? "");
    case "draft":
      return (
        a.sortOrder - b.sortOrder ||
        b.createdAt.getTime() - a.createdAt.getTime()
      );
    case "completed":
      return (b.endDate ?? "").localeCompare(a.endDate ?? "");
  }
}

/** Status, then project position, then B2's order inside the status. */
export function compareCycleRows(a: RankedCycle, b: RankedCycle): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.rank - b.rank ||
    compareWithinStatus(a, b) ||
    a.id.localeCompare(b.id)
  );
}

/** Mean of the last few values, one decimal; null for none. */
export function recentAverage(
  values: ReadonlyArray<number | null>,
  over = AVERAGE_OVER,
): number | null {
  const recent = values
    .slice(-over)
    .filter((value): value is number => value !== null);
  if (recent.length === 0) return null;
  const mean = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  return Math.round(mean * 10) / 10;
}

type CycleNumbers = ReturnType<typeof planningNumbers> & PlanningPoints;

function cycleNumbers(
  cycle: CycleRecord,
  tally: PlanningTally,
  canContribute: boolean,
): CycleNumbers {
  const snapshot = cycle.progressSnapshot;
  if (!snapshot) {
    return {
      ...planningNumbers(tally.counts),
      ...livePoints(tally, canContribute),
    };
  }
  const counts = snapshot.counts;
  const estimates = snapshot.estimates;
  const frozenPoints =
    canContribute && estimates?.enabled && estimates.type === "points"
      ? {
          committedPoints: round2(
            (estimates.total ?? 0) - (estimates.byGroup.cancelled.total ?? 0),
          ),
          completedPoints: round2(estimates.completed ?? 0),
        }
      : NO_POINTS;
  return {
    counts,
    committed: counts.total - counts.cancelled,
    pending: snapshot.pending,
    progress: snapshot.progress,
    ...frozenPoints,
  };
}

export async function getAnalyticsCycles(
  caller: AnalyticsCaller,
  { projectIds, timeZone }: { projectIds?: string[]; timeZone?: string },
): Promise<AnalyticsCycles> {
  return analyticsRead(async (tx) => {
    const context = await loadAnalyticsContext(tx, caller, {
      projectIds,
      timeZone,
    });
    const today = context.utcToday;
    const enabled = projectsWithFeature(context, "cycles");
    const velocityProject = enabled.length === 1 ? enabled[0] : undefined;
    const empty: AnalyticsCycles = {
      today,
      enabledProjectIds: enabled,
      summary: { current: 0, upcoming: 0, draft: 0, completedRecent: 0 },
      rows: [],
      velocity: velocityProject ? [] : null,
      averageCompleted: null,
      averageCompletedPoints: null,
      meta: { projects: [] },
    };
    if (enabled.length === 0) return empty;

    const recentFrom = shiftDate(today, -RECENT_COMPLETED_DAYS);
    const listed = and(
      isNull(cycleTable.archivedAt),
      or(isNull(cycleTable.endDate), gte(cycleTable.endDate, recentFrom)),
    ) as SQL;
    const history = velocityProject
      ? and(
          eq(cycleTable.projectId, velocityProject),
          lt(cycleTable.endDate, today),
        )
      : undefined;
    const records: CycleRecord[] = await tx
      .select({
        id: cycleTable.id,
        projectId: cycleTable.projectId,
        name: cycleTable.name,
        startDate: cycleTable.startDate,
        endDate: cycleTable.endDate,
        sortOrder: cycleTable.sortOrder,
        createdAt: cycleTable.createdAt,
        archivedAt: cycleTable.archivedAt,
        progressSnapshot: cycleTable.progressSnapshot,
        hasPointsSystem: hasPointsSystemSql(cycleTable.projectId),
      })
      .from(cycleTable)
      .where(
        and(
          sql`${cycleTable.projectId} = any(${textArray(enabled)})`,
          history ? or(listed, history) : listed,
        ),
      );

    const tallies = new Map<string, PlanningTally>();
    if (records.length > 0) {
      const rows = await tx
        .select({
          cycleId: cycleTaskTable.cycleId,
          ...planningTallyColumns(context),
        })
        .from(cycleTaskTable)
        .innerJoin(taskTable, eq(taskTable.id, cycleTaskTable.taskId))
        .innerJoin(
          cycleTable,
          and(
            eq(cycleTable.id, cycleTaskTable.cycleId),
            eq(cycleTable.projectId, taskTable.projectId),
          ),
        )
        .leftJoin(columnTable, taskColumnJoin)
        .where(
          and(
            sql`${cycleTaskTable.cycleId} = any(${textArray(records.map((cycle) => cycle.id))})`,
            visibleTaskCondition,
          ),
        )
        .groupBy(cycleTaskTable.cycleId);
      for (const row of rows) tallies.set(row.cycleId, toPlanningTally(row));
    }

    const rank = projectRank(context);
    const estimatesOn = new Set(projectsWithFeature(context, "estimates"));
    const numbersOf = (cycle: CycleRecord) =>
      cycleNumbers(
        cycle,
        tallies.get(cycle.id) ?? EMPTY_TALLY,
        estimatesOn.has(cycle.projectId) && cycle.hasPointsSystem,
      );
    const ranked: RankedCycle[] = records.map((cycle) => ({
      ...cycle,
      status: deriveCycleStatus(cycle, today),
      rank: rank.get(cycle.projectId) ?? Number.MAX_SAFE_INTEGER,
    }));

    const listedCycles = ranked
      .filter(
        (cycle) =>
          cycle.archivedAt === null &&
          (cycle.endDate === null || cycle.endDate >= recentFrom),
      )
      .sort(compareCycleRows);
    const summary = { current: 0, upcoming: 0, draft: 0, completedRecent: 0 };
    for (const cycle of listedCycles) {
      if (cycle.status === "completed") summary.completedRecent++;
      else summary[cycle.status]++;
    }

    const rows: AnalyticsCycleRow[] = listedCycles
      .slice(0, MAX_CYCLE_ROWS)
      .map((cycle) => ({
        id: cycle.id,
        projectId: cycle.projectId,
        name: cycle.name,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        isFrozen: cycle.progressSnapshot !== null,
        ...numbersOf(cycle),
      }));

    let velocity: AnalyticsVelocityPoint[] | null = null;
    if (velocityProject) {
      velocity = ranked
        .filter(
          (cycle) =>
            cycle.projectId === velocityProject && cycle.status === "completed",
        )
        .sort(
          (a, b) =>
            (b.endDate ?? "").localeCompare(a.endDate ?? "") ||
            b.id.localeCompare(a.id),
        )
        .slice(0, VELOCITY_CYCLES)
        .reverse()
        .map((cycle) => {
          const numbers = numbersOf(cycle);
          return {
            cycleId: cycle.id,
            name: cycle.name,
            startDate: cycle.startDate,
            endDate: cycle.endDate,
            committed: numbers.committed,
            completed: numbers.counts.completed,
            committedPoints: numbers.committedPoints,
            completedPoints: numbers.completedPoints,
          };
        });
    }

    return {
      ...empty,
      summary,
      rows,
      velocity,
      averageCompleted: velocity
        ? recentAverage(velocity.map((point) => point.completed))
        : null,
      averageCompletedPoints: velocity
        ? recentAverage(velocity.map((point) => point.completedPoints))
        : null,
      meta: {
        projects: projectsMeta(
          context,
          rows.map((row) => row.projectId),
        ),
      },
    };
  });
}
