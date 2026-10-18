import type { ColumnGroup } from "../column/groups";
import { daySpan, shiftDate } from "../utils/calendar-date";
import { daysBetween } from "./flow-intervals";
import { blockedChains, type Edge, longestPath, topoOrder } from "./risk-graph";

// Risk radar signals (A3): every flag is computed from the tasks, their
// relations and the team's own cycle-time history. Pure; risk.ts loads the
// rows. Hidden tasks (restricted projects the caller can't see) take part in
// the graph maths but never appear by id.

export const MIN_CYCLE_TIME_SAMPLES = 10;
export const OVERDUE_CLUSTER_SIZE = 3;
export const OVERDUE_CLUSTER_HIGH = 5;
export const NEAR_DEADLINE_DAYS = 3;
export const SIGNAL_TASK_LIMIT = 20;

export const RISK_KINDS = [
  "critical_path",
  "blocked_chain",
  "ageing",
  "overdue_cluster",
  "unassigned_near_deadline",
  "dependency_loop",
  "overdue",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];
export type RiskSeverity = "high" | "medium" | "low";

export type RiskTask = {
  id: string;
  group: ColumnGroup;
  /** Due date as a calendar day in the workspace zone. */
  dueDay: string | null;
  assigneeIds: string[];
  /** Start of the current in-progress stint. */
  startedAt: Date | null;
  /** In a project the caller can't see: never shown by id. */
  hidden: boolean;
};

export type CycleTimeStats = {
  samples: number;
  p50Days: number | null;
  p85Days: number | null;
};

export type RiskInput = {
  today: string;
  now: Date;
  endDate: string | null;
  /** Open tasks of the scope. */
  scopeIds: readonly string[];
  /** Scope tasks plus every open blocker reached from them. */
  tasks: ReadonlyMap<string, RiskTask>;
  /** "blocks" edges (blocker → blocked) between open tasks. */
  blockEdges: readonly Edge[];
  /** "finish_before" edges between open tasks. */
  finishEdges: readonly Edge[];
  cycleTime: CycleTimeStats;
};

export type RiskSignal = {
  kind: RiskKind;
  severity: RiskSeverity;
  taskIds: string[];
  total: number;
  headTaskId?: string | null;
  assigneeId?: string | null;
  depth?: number;
  ageDays?: number;
  thresholdDays?: number;
  deadline?: string;
  /** critical_path: the day the chain is expected to finish. */
  finishDate?: string;
};

export type CriticalPath = {
  taskIds: string[];
  hiddenCount: number;
  total: number;
  unit: "days" | "tasks";
  finishDate: string | null;
  slackDays: number | null;
};

export type RiskResult = {
  signals: RiskSignal[];
  criticalPath: CriticalPath | null;
};

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function capped(ids: readonly string[]) {
  return { taskIds: ids.slice(0, SIGNAL_TASK_LIMIT), total: ids.length };
}

function ageDays(task: RiskTask, now: Date): number | null {
  return task.startedAt ? daysBetween(task.startedAt, now) : null;
}

/** The p85 threshold for "ageing", when the history supports one. */
function ageingThreshold(stats: CycleTimeStats): number | null {
  return stats.samples >= MIN_CYCLE_TIME_SAMPLES ? stats.p85Days : null;
}

export function computeRisks(input: RiskInput): RiskResult {
  const { tasks, today, now, endDate, cycleTime } = input;
  const visible = (id: string) => {
    const task = tasks.get(id);
    return Boolean(task && !task.hidden);
  };
  const scope = input.scopeIds
    .map((id) => tasks.get(id))
    .filter((task): task is RiskTask => Boolean(task && !task.hidden));
  const signals: RiskSignal[] = [];
  const threshold = ageingThreshold(cycleTime);
  const isAgeing = (task: RiskTask) => {
    const age = ageDays(task, now);
    return threshold !== null && age !== null && age > threshold;
  };

  // Critical path over every precedence edge.
  const nodes = [...tasks.keys()];
  const precedence = [...input.blockEdges, ...input.finishEdges];
  const { order, loopNodeIds } = topoOrder(nodes, precedence);
  const p50 =
    cycleTime.samples >= MIN_CYCLE_TIME_SAMPLES ? cycleTime.p50Days : null;
  const unit: CriticalPath["unit"] = p50 !== null ? "days" : "tasks";
  const weight = (id: string) => {
    if (p50 === null) return 1;
    const task = tasks.get(id);
    const age = task ? ageDays(task, now) : null;
    return Math.max(1, Math.ceil(age !== null ? p50 - age : p50));
  };
  const path = longestPath(order, precedence, weight);
  let criticalPath: CriticalPath | null = null;
  if (path.taskIds.length >= 2) {
    const finishDate =
      unit === "days" ? shiftDate(today, path.total - 1) : null;
    criticalPath = {
      taskIds: path.taskIds.filter(visible),
      hiddenCount: path.taskIds.filter((id) => !visible(id)).length,
      total: path.total,
      unit,
      finishDate,
      slackDays:
        finishDate !== null && endDate !== null
          ? daySpan(finishDate, endDate)
          : null,
    };
  }
  const pathLate =
    criticalPath?.slackDays !== null &&
    criticalPath?.slackDays !== undefined &&
    criticalPath.slackDays < 0;
  if (criticalPath && criticalPath.slackDays !== null) {
    const slack = criticalPath.slackDays;
    if (slack <= 2) {
      signals.push({
        kind: "critical_path",
        severity: slack < 0 ? "high" : "medium",
        ...capped(criticalPath.taskIds),
        deadline: endDate ?? undefined,
        finishDate: criticalPath.finishDate ?? undefined,
      });
    }
  }
  const onPath = new Set(path.taskIds);

  // Blocked chains over "blocks" edges.
  const scopeIds = new Set(scope.map((task) => task.id));
  for (const chain of blockedChains(nodes, input.blockEdges)) {
    const blocked = chain.blockedIds.filter(
      (id) => scopeIds.has(id) && visible(id),
    );
    if (blocked.length === 0) continue;
    const head = tasks.get(chain.headId);
    const headVisible = Boolean(head && !head.hidden);
    const headUnassigned = headVisible && head?.assigneeIds.length === 0;
    const headAgeing = headVisible && head ? isAgeing(head) : false;
    const severity: RiskSeverity =
      headUnassigned || headAgeing || (pathLate && onPath.has(chain.headId))
        ? "high"
        : blocked.length >= 2 || chain.depth >= 2
          ? "medium"
          : "low";
    signals.push({
      kind: "blocked_chain",
      severity,
      ...capped(blocked),
      headTaskId: headVisible ? chain.headId : null,
      depth: chain.depth,
    });
  }

  // Dependency loops (older data only; the API refuses new ones).
  const loopIds = loopNodeIds.filter(visible);
  if (loopIds.length > 0) {
    signals.push({
      kind: "dependency_loop",
      severity: "medium",
      ...capped(loopIds),
    });
  }

  // Ageing work: in progress longer than the team's p85 cycle time.
  if (threshold !== null) {
    const ageing = scope
      .filter((task) => task.group === "started" && isAgeing(task))
      .map((task) => ({ id: task.id, age: ageDays(task, now) ?? 0 }))
      .sort((a, b) => b.age - a.age || (a.id < b.id ? -1 : 1));
    if (ageing.length > 0) {
      const oldest = ageing[0]?.age ?? 0;
      signals.push({
        kind: "ageing",
        severity: oldest > 2 * threshold ? "high" : "medium",
        ...capped(ageing.map((entry) => entry.id)),
        ageDays: Math.round(oldest * 10) / 10,
        thresholdDays: Math.round(threshold * 10) / 10,
      });
    }
  }

  // Overdue work, clustered by first assignee.
  const overdue = scope.filter(
    (task) => task.dueDay !== null && task.dueDay < today,
  );
  const byAssignee = new Map<string, RiskTask[]>();
  for (const task of overdue) {
    const key = task.assigneeIds[0] ?? "";
    byAssignee.set(key, [...(byAssignee.get(key) ?? []), task]);
  }
  const loose: string[] = [];
  for (const [assignee, list] of [...byAssignee.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const ids = list
      .sort((a, b) => (a.dueDay ?? "").localeCompare(b.dueDay ?? ""))
      .map((task) => task.id);
    if (ids.length >= OVERDUE_CLUSTER_SIZE) {
      signals.push({
        kind: "overdue_cluster",
        severity: ids.length >= OVERDUE_CLUSTER_HIGH ? "high" : "medium",
        ...capped(ids),
        assigneeId: assignee || null,
      });
    } else {
      loose.push(...ids);
    }
  }
  if (loose.length > 0) {
    signals.push({ kind: "overdue", severity: "low", ...capped(loose) });
  }

  // Unassigned work whose deadline (its due date or the scope's end) is near.
  const near: Array<{ id: string; days: number; deadline: string }> = [];
  for (const task of scope) {
    if (task.assigneeIds.length > 0) continue;
    const candidates = [task.dueDay, endDate].filter(
      (day): day is string => day !== null && day >= today,
    );
    if (task.dueDay !== null && task.dueDay < today) continue;
    const deadline = candidates.sort()[0];
    if (!deadline) continue;
    const days = daySpan(today, deadline);
    if (days <= NEAR_DEADLINE_DAYS) near.push({ id: task.id, days, deadline });
  }
  if (near.length > 0) {
    near.sort((a, b) => a.days - b.days || (a.id < b.id ? -1 : 1));
    const soonest = near[0] as (typeof near)[number];
    signals.push({
      kind: "unassigned_near_deadline",
      severity: soonest.days <= 1 ? "high" : "medium",
      ...capped(near.map((entry) => entry.id)),
      deadline: soonest.deadline,
    });
  }

  signals.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.total - a.total ||
      RISK_KINDS.indexOf(a.kind) - RISK_KINDS.indexOf(b.kind),
  );
  return { signals, criticalPath };
}
