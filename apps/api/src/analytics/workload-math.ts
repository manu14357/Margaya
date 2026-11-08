import { round2 } from "./metrics";

// Per-person workload: pure maths. The usual is what the person actually
// finished recently, never a target; someone without history is unknown,
// never over (the same rule as the cycle capacity check).

/** Completed work read for a person's usual, in days. */
export const WORKLOAD_HISTORY_DAYS = 56;
/** The span the usual is scaled to, in days. */
export const WORKLOAD_USUAL_DAYS = 28;

export const WORKLOAD_GROUPS = ["backlog", "unstarted", "started"] as const;
export type WorkloadGroup = (typeof WORKLOAD_GROUPS)[number];

export type WorkloadUnit = "tasks" | "points";
export type WorkloadStatus = "ok" | "over" | "unknown";

/** Open tasks of one assignee (null: unassigned) in one group. */
export type OpenRow = {
  userId: string | null;
  group: string;
  tasks: number;
  points: number;
  /** Tasks with estimate points. */
  sized: number;
};

/** What one person finished over the history. */
export type DoneRow = { userId: string; tasks: number; points: number };

export type WorkloadCheck = {
  unit: WorkloadUnit;
  load: number;
  usual: number | null;
  status: WorkloadStatus;
};

export type WorkloadMember = {
  userId: string | null;
  tasks: number;
  points: number;
  load: number;
  cells: Record<WorkloadGroup, number>;
  check: WorkloadCheck | null;
};

const isWorkloadGroup = (group: string): group is WorkloadGroup =>
  (WORKLOAD_GROUPS as readonly string[]).includes(group);

/** Most of the work has to be sized, or a points total says little. */
const mostlySized = (sized: number, tasks: number) =>
  sized > 0 && sized * 2 >= tasks;

const usualOf = (finished: number) =>
  round2((finished * WORKLOAD_USUAL_DAYS) / WORKLOAD_HISTORY_DAYS);

/**
 * One person's open work against their usual. A person whose own open work
 * is mostly unsized is checked by task count even when the team's unit is
 * points, so unestimated work can't hide an overload.
 */
function checkOf(
  member: { tasks: number; points: number; sized: number },
  done: DoneRow | undefined,
  unit: WorkloadUnit,
): WorkloadCheck {
  const checkUnit: WorkloadUnit =
    unit === "points" && mostlySized(member.sized, member.tasks)
      ? "points"
      : "tasks";
  const load = checkUnit === "points" ? round2(member.points) : member.tasks;
  const usual = usualOf(
    (checkUnit === "points" ? done?.points : done?.tasks) ?? 0,
  );
  if (usual <= 0) {
    return { unit: checkUnit, load, usual: null, status: "unknown" };
  }
  return {
    unit: checkUnit,
    load,
    usual,
    status: load > usual ? "over" : "ok",
  };
}

/**
 * Open work per assignee, heaviest first with unassigned last. The unit is
 * points only when a scope project has a points system and most open work
 * is sized; otherwise task counts. `check` is left out without
 * `includeCheck`, and never applies to unassigned work.
 */
export function buildWorkload({
  open,
  done,
  pointsAvailable,
  includeCheck,
}: {
  open: readonly OpenRow[];
  done: readonly DoneRow[];
  pointsAvailable: boolean;
  includeCheck: boolean;
}): { unit: WorkloadUnit; members: WorkloadMember[] } {
  const totals = { tasks: 0, sized: 0 };
  const tallies = new Map<
    string | null,
    {
      tasks: number;
      points: number;
      sized: number;
      byGroup: Record<WorkloadGroup, { tasks: number; points: number }>;
    }
  >();
  for (const row of open) {
    if (!isWorkloadGroup(row.group)) continue;
    totals.tasks += row.tasks;
    totals.sized += row.sized;
    const tally = tallies.get(row.userId) ?? {
      tasks: 0,
      points: 0,
      sized: 0,
      byGroup: {
        backlog: { tasks: 0, points: 0 },
        unstarted: { tasks: 0, points: 0 },
        started: { tasks: 0, points: 0 },
      },
    };
    tally.tasks += row.tasks;
    tally.points += row.points;
    tally.sized += row.sized;
    tally.byGroup[row.group].tasks += row.tasks;
    tally.byGroup[row.group].points += row.points;
    tallies.set(row.userId, tally);
  }

  const unit: WorkloadUnit =
    pointsAvailable && mostlySized(totals.sized, totals.tasks)
      ? "points"
      : "tasks";
  const doneBy = new Map(done.map((row) => [row.userId, row]));
  const inUnit = (entry: { tasks: number; points: number }) =>
    unit === "points" ? round2(entry.points) : entry.tasks;

  const members = [...tallies.entries()].map(
    ([userId, tally]): WorkloadMember => ({
      userId,
      tasks: tally.tasks,
      points: round2(tally.points),
      load: inUnit(tally),
      cells: {
        backlog: inUnit(tally.byGroup.backlog),
        unstarted: inUnit(tally.byGroup.unstarted),
        started: inUnit(tally.byGroup.started),
      },
      check:
        includeCheck && userId
          ? checkOf(tally, doneBy.get(userId), unit)
          : null,
    }),
  );
  members.sort(
    (a, b) =>
      Number(a.userId === null) - Number(b.userId === null) ||
      b.load - a.load ||
      b.tasks - a.tasks ||
      (a.userId ?? "").localeCompare(b.userId ?? ""),
  );
  return { unit, members };
}
