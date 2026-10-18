import { and, asc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import db from "../database";
import {
  flowAlertTable,
  projectAutomationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import { notifySystem } from "../notification/system";
import { hiddenProjectIdsAnywhere } from "../project/visibility";
import { withJobLease } from "../scheduler/leader-lock";
import { listDays, shiftDate, todayUtc } from "../utils/calendar-date";
import {
  localDateString,
  resolveTimezone,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  todayInTimezone,
} from "../utils/zoned-date";
import {
  BASELINE_WEEKS,
  chunkWeeks,
  detectFlowAnomalies,
  type FlowAnomaly,
  type FlowMetric,
  WEEK_DAYS,
  type WeeklySeries,
  weekStartOf,
} from "./anomaly";
import { dailyThroughput, flowTasksSince } from "./flow-history";
import { cycleTimeDays, wipAt } from "./flow-intervals";
import { median } from "./stats";

// Flow anomaly alerts (A4), opt-in per project. Hourly under a job lease;
// each opted-in project is checked once per workspace day. The last seven
// days are compared with the eight weeks before them; an anomaly is stored
// once per metric and calendar week (Monday start), and only that first
// insert notifies the project lead.

export const FLOW_ALERTS_LEASE = "flow-alerts";
const LEASE_MS = 15 * 60 * 1000;
export const FLOW_ANOMALY_NOTIFICATION_TYPE = "flow_anomaly";
const MIN_WEEKLY_CYCLE_TIMES = 3;
const AFFECTED_TASK_LIMIT = 10;

export type FlowAlertLimits = { projects: number; budgetMs: number };

export const DEFAULT_FLOW_ALERT_LIMITS: FlowAlertLimits = {
  projects: 200,
  budgetMs: 4 * 60 * 1000,
};

export type FlowAlertOutcome = {
  degraded: boolean;
  projects: number;
  alerts: number;
};

function toSeries(weekly: Array<number | null>): WeeklySeries {
  return {
    baseline: weekly.slice(0, BASELINE_WEEKS),
    current: weekly[BASELINE_WEEKS] ?? null,
  };
}

type Candidate = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  leadUserId: string | null;
  createdAt: Date;
  timezone: string;
  checkedOn: string | null;
};

async function loadCandidates(now: Date, limit: number): Promise<Candidate[]> {
  const rows = await db
    .select({
      projectId: projectTable.id,
      projectName: projectTable.name,
      workspaceId: projectTable.workspaceId,
      leadUserId: projectTable.leadUserId,
      createdAt: projectTable.createdAt,
      timezone: workspaceTable.timezone,
      checkedOn: projectAutomationTable.flowAlertsCheckedOn,
    })
    .from(projectAutomationTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, projectAutomationTable.projectId),
    )
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(
      and(
        eq(projectAutomationTable.flowAlertsEnabled, true),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
        or(
          isNull(projectAutomationTable.flowAlertsCheckedOn),
          // No zone is more than a day ahead of UTC; the exact local check
          // happens per project below.
          lt(
            projectAutomationTable.flowAlertsCheckedOn,
            shiftDate(todayUtc(now), 1),
          ),
        ),
      ),
    )
    .orderBy(
      asc(projectAutomationTable.flowAlertsCheckedOn),
      asc(projectTable.id),
    )
    .limit(limit * 5);
  return rows
    .map((row) => ({ ...row, timezone: resolveTimezone(row.timezone) }))
    .filter(
      (row) =>
        row.checkedOn === null ||
        row.checkedOn < todayInTimezone(row.timezone, now),
    )
    .slice(0, limit);
}

/** The project's weekly series ending yesterday, or null without history. */
export async function projectFlowSeries(
  projectId: string,
  timeZone: string,
  projectCreatedAt: Date,
  now: Date,
): Promise<{
  series: Record<FlowMetric, WeeklySeries>;
  windowStart: string;
  windowEnd: string;
  startedTaskIds: string[];
} | null> {
  const today = todayInTimezone(timeZone, now);
  const windowEnd = shiftDate(today, -1);
  const windowStart = shiftDate(windowEnd, -(WEEK_DAYS - 1));
  const firstDay = shiftDate(windowStart, -BASELINE_WEEKS * WEEK_DAYS);
  // Imports may carry completions older than the project row itself.
  const [first] = await db
    .select({ completedAt: taskTable.completedAt })
    .from(taskTable)
    .where(
      and(eq(taskTable.projectId, projectId), isNotNull(taskTable.completedAt)),
    )
    .orderBy(asc(taskTable.completedAt))
    .limit(1);
  const created = localDateString(projectCreatedAt, timeZone);
  const firstDone = first?.completedAt
    ? localDateString(first.completedAt, timeZone)
    : created;
  if ((firstDone < created ? firstDone : created) > firstDay) return null;

  const days = listDays(firstDay, windowEnd);
  const throughput = await dailyThroughput(
    db,
    projectId,
    firstDay,
    windowEnd,
    timeZone,
  );
  const flows = await flowTasksSince(
    db,
    projectId,
    startOfLocalDayUtc(firstDay, timeZone),
  );
  const wip = wipAt(
    flows.map((task) => task.flow),
    days.map((day) => startOfNextLocalDayUtc(day, timeZone)),
  );
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const cycleTimes: number[][] = days.map(() => []);
  for (const task of flows) {
    if (task.group !== "completed" || !task.completedAt) continue;
    const index = dayIndex.get(localDateString(task.completedAt, timeZone));
    const days = cycleTimeDays(task.flow, task.completedAt);
    if (index !== undefined && days !== null) cycleTimes[index]?.push(days);
  }

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const startedTaskIds = flows
    .filter((task) => task.flow.currentStartedAt)
    .sort(
      (a, b) =>
        (a.flow.currentStartedAt?.getTime() ?? 0) -
          (b.flow.currentStartedAt?.getTime() ?? 0) || (a.id < b.id ? -1 : 1),
    )
    .slice(0, AFFECTED_TASK_LIMIT)
    .map((task) => task.id);

  return {
    windowStart,
    windowEnd,
    startedTaskIds,
    series: {
      throughput: toSeries(chunkWeeks(throughput).map(sum)),
      wip: toSeries(
        chunkWeeks(wip).map(
          (week) => Math.round((sum(week) / week.length) * 10) / 10,
        ),
      ),
      cycle_time: toSeries(
        chunkWeeks(cycleTimes).map((week) => {
          const samples = week.flat();
          if (samples.length < MIN_WEEKLY_CYCLE_TIMES) return null;
          return Math.round((median(samples) ?? 0) * 10) / 10;
        }),
      ),
    },
  };
}

const METRIC_TEXT: Record<FlowMetric, (anomaly: FlowAnomaly) => string> = {
  throughput: (a) =>
    `Throughput dropped to ${a.value} tasks this week (usually about ${a.median}).`,
  wip: (a) =>
    `Work in progress rose to ${a.value} tasks on average (usually about ${a.median}).`,
  cycle_time: (a) =>
    `Cycle time rose to ${a.value} days (usually about ${a.median}).`,
};

async function notifyLead(
  candidate: Candidate,
  anomaly: FlowAnomaly,
  window: { windowStart: string; windowEnd: string },
  taskIds: string[],
) {
  if (!candidate.leadUserId) return false;
  const hidden = await hiddenProjectIdsAnywhere(candidate.leadUserId, [
    candidate.projectId,
  ]);
  if (hidden.has(candidate.projectId)) return false;
  const notification = await notifySystem({
    userId: candidate.leadUserId,
    type: FLOW_ANOMALY_NOTIFICATION_TYPE,
    // English fallbacks for email and digests; the web renders the type.
    title: `Unusual flow in ${candidate.projectName}`,
    content: METRIC_TEXT[anomaly.metric](anomaly),
    eventData: {
      projectId: candidate.projectId,
      projectName: candidate.projectName,
      metric: anomaly.metric,
      direction: anomaly.direction,
      value: anomaly.value,
      baselineMedian: anomaly.median,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      taskIds,
    },
    resourceId: candidate.workspaceId,
    resourceType: "workspace",
  });
  return notification !== null;
}

async function checkProject(candidate: Candidate, now: Date): Promise<number> {
  const result = await projectFlowSeries(
    candidate.projectId,
    candidate.timezone,
    candidate.createdAt,
    now,
  );
  let alerts = 0;
  if (result) {
    const weekKey = weekStartOf(result.windowEnd);
    for (const anomaly of detectFlowAnomalies(result.series)) {
      const [inserted] = await db
        .insert(flowAlertTable)
        .values({
          projectId: candidate.projectId,
          metric: anomaly.metric,
          direction: anomaly.direction,
          windowStart: weekKey,
          windowEnd: result.windowEnd,
          value: anomaly.value,
          baselineMedian: anomaly.median,
          baselineScale: anomaly.scale,
          notifiedUserId: candidate.leadUserId,
        })
        .onConflictDoNothing()
        .returning({ id: flowAlertTable.id });
      if (!inserted) continue;
      alerts++;
      const taskIds =
        anomaly.metric === "throughput" ? [] : result.startedTaskIds;
      const sent = await notifyLead(candidate, anomaly, result, taskIds);
      if (!sent) {
        await db
          .update(flowAlertTable)
          .set({ notifiedUserId: null })
          .where(eq(flowAlertTable.id, inserted.id));
      }
    }
  }
  await db
    .update(projectAutomationTable)
    .set({
      flowAlertsCheckedOn: todayInTimezone(candidate.timezone, now),
      ...(alerts > 0 ? { lastFlowAlertAt: now } : {}),
    })
    .where(eq(projectAutomationTable.projectId, candidate.projectId));
  return alerts;
}

async function runOnce(
  now: Date,
  limits: FlowAlertLimits,
): Promise<FlowAlertOutcome> {
  const started = Date.now();
  const candidates = await loadCandidates(now, limits.projects);
  let degraded = false;
  let projects = 0;
  let alerts = 0;
  for (const candidate of candidates) {
    if (Date.now() - started > limits.budgetMs) break;
    try {
      alerts += await checkProject(candidate, now);
      projects++;
    } catch (error) {
      degraded = true;
      console.error("Flow alert check failed", {
        projectId: candidate.projectId,
        error,
      });
    }
  }
  return { degraded, projects, alerts };
}

export function runFlowAlerts(
  now: Date = new Date(),
  limits: FlowAlertLimits = DEFAULT_FLOW_ALERT_LIMITS,
): Promise<FlowAlertOutcome> {
  return withJobLease(
    FLOW_ALERTS_LEASE,
    () => runOnce(now, limits),
    () => ({ degraded: false, projects: 0, alerts: 0 }),
    LEASE_MS,
  );
}
