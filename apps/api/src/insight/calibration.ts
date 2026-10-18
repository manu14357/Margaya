import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { columnTable, labelTable, taskTable } from "../database/schema";
import { type ActiveEstimate, getEnabledEstimate } from "../estimate/totals";
import { searchWorkspace } from "../search/search-workspace";
import {
  taskColumnJoin,
  taskGroupSql,
  visibleTaskCondition,
} from "../task/scope";
import {
  calibrationBuckets,
  MAX_SIMILAR,
  type SimilarSample,
  similarityQuery,
  spreadOf,
  suggestEstimate,
} from "./calibration-math";
import { completedCycleDays, projectSlug, taskKey } from "./shared";

// Calibrated estimates (#9): what similar finished tasks were estimated and
// how long they really took, and the team's estimate-vs-actual calibration.
// Per project only; text similarity comes from full-text search run as the
// caller (searchWorkspace), so nothing they can't see is ever compared.

/** Completed tasks the calibration reads: the last 180 days, at most 500. */
export const CALIBRATION_WINDOW_DAYS = 180;
export const CALIBRATION_TASK_LIMIT = 500;
/** Completed tasks sharing a label that are compared, at most. */
const LABEL_CANDIDATES = 200;

const DAY_MS = 86_400_000;
const COMPLETED = sql`${taskGroupSql} = 'completed'`;

type PermissionCheck = (permissions: Record<string, string[]>) => boolean;

/** GET /insight/estimate/project/{projectId}/calibration */
export async function getCalibration(projectId: string, now = new Date()) {
  const estimate = await getEnabledEstimate(projectId, db);
  if (!estimate) {
    return {
      status: "no_estimate" as const,
      estimateType: null,
      estimateName: null,
      windowDays: CALIBRATION_WINDOW_DAYS,
      samples: 0,
      unmeasured: 0,
      ordered: null,
      buckets: [],
    };
  }
  const since = new Date(now.getTime() - CALIBRATION_WINDOW_DAYS * DAY_MS);
  const rows = await db
    .select({ id: taskTable.id, pointId: taskTable.estimatePointId })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
        COMPLETED,
        gte(taskTable.completedAt, since),
        inArray(
          taskTable.estimatePointId,
          estimate.points.map((point) => point.id),
        ),
      ),
    )
    .orderBy(desc(taskTable.completedAt))
    .limit(CALIBRATION_TASK_LIMIT);
  const days = await completedCycleDays(
    db,
    projectId,
    rows.map((row) => row.id),
  );
  const samples = rows.flatMap((row) => {
    const cycleDays = days.get(row.id);
    return row.pointId && cycleDays !== undefined
      ? [{ pointId: row.pointId, cycleDays }]
      : [];
  });
  const { buckets, ordered } = calibrationBuckets(
    estimate.points.map(({ id, value, position }) => ({ id, value, position })),
    samples,
  );
  return {
    status: "ok" as const,
    estimateType: estimate.type,
    estimateName: estimate.name,
    windowDays: CALIBRATION_WINDOW_DAYS,
    samples: samples.length,
    // Completed and estimated, but never seen in a started column.
    unmeasured: rows.length - samples.length,
    ordered,
    buckets,
  };
}

/** The task being estimated: its title and label names, or a typed title. */
async function subjectOf(
  projectId: string,
  input: { taskId?: string; title?: string },
) {
  if (!input.taskId) {
    return { taskId: null, title: input.title?.trim() ?? "", labels: [] };
  }
  const [task] = await db
    .select({ id: taskTable.id, title: taskTable.title })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.id, input.taskId),
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
      ),
    )
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  const labels = await db
    .select({ name: labelTable.name })
    .from(labelTable)
    .where(eq(labelTable.taskId, task.id));
  return {
    taskId: task.id,
    title: input.title?.trim() || task.title,
    labels: [...new Set(labels.map((label) => label.name.toLowerCase()))],
  };
}

/** Completed, estimated tasks sharing a label with the subject. */
async function labelMatches(
  projectId: string,
  labels: readonly string[],
  pointIds: readonly string[],
  excludeId: string | null,
) {
  const matches = new Map<string, string[]>();
  if (labels.length === 0) return matches;
  const rows = await db
    .select({ taskId: taskTable.id, name: labelTable.name })
    .from(labelTable)
    .innerJoin(taskTable, eq(taskTable.id, labelTable.taskId))
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        visibleTaskCondition,
        COMPLETED,
        inArray(taskTable.estimatePointId, [...pointIds]),
        inArray(sql`lower(${labelTable.name})`, [...labels]),
        excludeId ? ne(taskTable.id, excludeId) : undefined,
      ),
    )
    .orderBy(desc(taskTable.completedAt))
    .limit(LABEL_CANDIDATES);
  for (const row of rows) {
    const list = matches.get(row.taskId) ?? [];
    if (!list.includes(row.name)) list.push(row.name);
    matches.set(row.taskId, list);
  }
  return matches;
}

function emptySuggestion(
  status: "no_estimate" | "insufficient_history",
  estimate: ActiveEstimate | null,
) {
  return {
    status,
    estimateType: estimate?.type ?? null,
    suggestion: null,
    cycleTime: null,
    similar: [],
  };
}

export type EstimateSuggestionResult = Awaited<
  ReturnType<typeof getEstimateSuggestion>
>;

/**
 * GET /insight/estimate/project/{projectId}/suggestion: the estimate that
 * similar completed tasks of the project usually had (text rank via
 * full-text search plus shared labels), with their actual cycle times.
 */
export async function getEstimateSuggestion(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  taskId?: string;
  title?: string;
  can?: PermissionCheck;
}) {
  const estimate = await getEnabledEstimate(input.projectId, db);
  if (!estimate || estimate.points.length === 0) {
    return emptySuggestion("no_estimate", estimate);
  }
  const subject = await subjectOf(input.projectId, input);
  const pointIds = estimate.points.map((point) => point.id);
  const query = similarityQuery(subject.title);
  const [hits, byLabel] = await Promise.all([
    query
      ? searchWorkspace({
          userId: input.userId,
          workspaceId: input.workspaceId,
          query,
          types: ["task"],
          limit: 50,
          projectId: input.projectId,
          can: input.can,
        })
      : Promise.resolve([]),
    labelMatches(input.projectId, subject.labels, pointIds, subject.taskId),
  ]);
  const textScore = new Map<string, number>();
  for (const hit of hits) {
    if (hit.type === "task" && hit.id !== subject.taskId) {
      textScore.set(hit.id, hit.score);
    }
  }
  const candidateIds = [...new Set([...textScore.keys(), ...byLabel.keys()])];
  if (candidateIds.length === 0) {
    return emptySuggestion("insufficient_history", estimate);
  }

  const rows = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      pointId: taskTable.estimatePointId,
      completedAt: taskTable.completedAt,
    })
    .from(taskTable)
    .leftJoin(columnTable, taskColumnJoin)
    .where(
      and(
        inArray(taskTable.id, candidateIds),
        eq(taskTable.projectId, input.projectId),
        visibleTaskCondition,
        COMPLETED,
        isNotNull(taskTable.completedAt),
        inArray(taskTable.estimatePointId, pointIds),
      ),
    );
  const points = new Map(estimate.points.map((point) => [point.id, point]));
  const ranked = rows
    .map((row) => {
      const labels = byLabel.get(row.id) ?? [];
      return {
        ...row,
        labels,
        weight: (textScore.get(row.id) ?? 0) + labels.length,
      };
    })
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0),
    )
    .slice(0, MAX_SIMILAR);

  const [slug, days] = await Promise.all([
    projectSlug(db, input.projectId),
    completedCycleDays(
      db,
      input.projectId,
      ranked.map((row) => row.id),
    ),
  ]);
  const samples: SimilarSample[] = ranked.flatMap((row) => {
    const point = row.pointId ? points.get(row.pointId) : undefined;
    return point
      ? [
          {
            pointId: point.id,
            position: point.position,
            cycleDays: days.get(row.id) ?? null,
            weight: row.weight,
          },
        ]
      : [];
  });
  const suggestion = suggestEstimate(samples);
  const cycleDays = ranked.flatMap((row) => {
    const value = days.get(row.id);
    return value === undefined ? [] : [value];
  });
  const spread = spreadOf(cycleDays);
  const suggested = suggestion ? points.get(suggestion.pointId) : undefined;
  return {
    status: suggestion ? ("ok" as const) : ("insufficient_history" as const),
    estimateType: estimate.type,
    suggestion:
      suggestion && suggested
        ? { ...suggestion, value: suggested.value }
        : null,
    cycleTime:
      spread.samples > 0
        ? {
            samples: spread.samples,
            min: spread.min as number,
            median: spread.median as number,
            max: spread.max as number,
          }
        : null,
    similar: ranked.map((row) => {
      const cycle = days.get(row.id);
      return {
        id: row.id,
        key: taskKey(slug ?? "", row.number),
        title: row.title,
        projectId: input.projectId,
        pointId: row.pointId as string,
        value: points.get(row.pointId as string)?.value ?? "",
        cycleTimeDays: cycle === undefined ? null : Math.round(cycle * 10) / 10,
        sharedLabels: row.labels,
      };
    }),
  };
}
