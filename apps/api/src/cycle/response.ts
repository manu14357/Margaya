import { estimateTotalsSchema } from "../estimate/response";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import {
  calendarDaySchema,
  nullableCalendarDaySchema,
  progressResponseSchemas,
} from "../task/progress-response";
import { CYCLE_STATUSES } from "./types";

const progressSchemas = progressResponseSchemas("Cycle");

export const cycleStatusSchema = z.enum(CYCLE_STATUSES).openapi("CycleStatus", {
  description:
    "Derived from the dates against the server's UTC today: draft (no dates), upcoming (starts after today), current (today is inside the inclusive range), completed (ended before today). Archived cycles are always completed.",
});

export const cycleCountsSchema = progressSchemas.counts;

const cycleOwnerSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("CycleOwner");

export const cycleSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    description: z.string(),
    startDate: nullableCalendarDaySchema,
    endDate: nullableCalendarDaySchema,
    ownerId: z.string().nullable(),
    owner: cycleOwnerSchema.nullable(),
    sortOrder: z.number(),
    status: cycleStatusSchema,
    today: calendarDaySchema.openapi({
      description: "The server's UTC date the status was derived from.",
    }),
    archivedAt: nullableResponseTimestamp,
    isFrozen: z.boolean().openapi({
      description:
        "True once unfinished tasks were transferred out; counts and progress then come from the report frozen at that moment.",
    }),
    counts: cycleCountsSchema,
    pending: z.number().openapi({
      description: "Unfinished tasks: backlog + unstarted + started.",
    }),
    progress: z.number().openapi({
      description:
        "Percent done, 0–100: completed ÷ (total − cancelled), rounded. 0 without tasks, 100 when every task is cancelled.",
    }),
    rollover: z
      .object({
        at: responseTimestamp,
        outcome: z.enum(["moved", "nothing_to_move", "no_next_cycle"]),
        movedCount: z.number().int(),
        targetCycleId: z.string().nullable(),
        targetCycleName: z.string().nullable(),
      })
      .nullable()
      .openapi({
        description:
          "What the project's cycle auto-rollover did when this cycle ended; null until it ran (or while it is off).",
      }),
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Cycle");

export const cycleListSchema = z.array(cycleSchema);

export const cycleProgressSchema = z
  .object({
    cycleId: z.string(),
    isFrozen: z.boolean(),
    frozenAt: nullableResponseTimestamp,
    today: calendarDaySchema,
    counts: cycleCountsSchema,
    pending: z.number(),
    progress: z.number(),
    chart: progressSchemas.chart.nullable().openapi({
      description:
        "Burn-down and burn-up data over every day of the cycle. Null for drafts and when no task is in scope.",
    }),
    assignees: z.array(progressSchemas.assignee),
    labels: z.array(progressSchemas.label),
    priorities: z.array(progressSchemas.priority),
    estimates: estimateTotalsSchema.nullable().openapi({
      description:
        "Estimate totals over the same tasks. enabled is false while the project's estimates feature is off or no system is active. Null only for a report frozen before estimates existed.",
    }),
    estimateChart: progressSchemas.chart.nullable().openapi({
      description:
        "The chart in points mode: every number sums estimate values (minutes for time systems) instead of counting tasks, and tasks without an estimate weigh 0. Null unless a numeric system is active and the cycle has dates and estimated tasks.",
    }),
  })
  .openapi("CycleProgress");

export const cycleTaskChangeSchema = z
  .object({
    cycleId: z.string(),
    added: z.array(z.string()),
    moved: z.array(
      z
        .object({ taskId: z.string(), fromCycleId: z.string() })
        .openapi("CycleTaskMove"),
    ),
    removed: z.array(z.string()),
    unchanged: z.array(z.string()).openapi({
      description: "Already in this cycle (add), or not in it (remove).",
    }),
    ignored: z.array(z.string()).openapi({
      description:
        "Not a visible task of the cycle's project. Not an error, so repeated bulk calls stay safe.",
    }),
  })
  .openapi("CycleTaskChange");

export const taskCycleAssignmentSchema = z
  .object({
    taskId: z.string(),
    cycleId: z.string().nullable(),
    previousCycleId: z.string().nullable(),
  })
  .openapi("TaskCycleAssignment");

export const cycleTransferResultSchema = z
  .object({
    sourceCycleId: z.string(),
    targetCycleId: z.string(),
    movedTaskIds: z.array(z.string()),
    isFrozen: z.boolean(),
  })
  .openapi("CycleTransferResult");

export const cycleDeleteResultSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    removedTaskIds: z.array(z.string()),
  })
  .openapi("CycleDeleteResult");
