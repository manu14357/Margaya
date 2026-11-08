import { nullableResponseTimestamp, z } from "../openapi";
import { RISK_KINDS } from "./risk-signals";
import { SCOPE_TYPES } from "./scope";

const day = z.string().openapi({ description: "A calendar day, YYYY-MM-DD." });

const scopeSchema = z.object({
  type: z.enum(SCOPE_TYPES),
  id: z.string(),
  projectId: z.string(),
  endDate: day.nullable().openapi({
    description:
      "The cycle's end date or the module's target date; null for a project or an undated cycle or module.",
  }),
});

const forecastPoint = z
  .object({
    days: z.number().int().openapi({
      description: "Calendar days from today, today being day 1.",
    }),
    date: day,
  })
  .nullable();

export const deliveryForecastSchema = z
  .object({
    scope: scopeSchema,
    status: z.enum(["ok", "insufficient_history", "complete"]).openapi({
      description:
        "ok: percentiles are set. insufficient_history: too little history to forecast (see reason). complete: no open tasks are left.",
    }),
    reason: z
      .enum(["short_span", "few_completions", "few_active_days"])
      .nullable()
      .openapi({
        description:
          "Why the history is too thin: under 14 days of history, under 5 completions, or under 3 days with a completion.",
      }),
    today: day,
    remaining: z.number().int().openapi({
      description: "Open tasks in scope (backlog, not started, started).",
    }),
    history: z.object({
      from: day.nullable(),
      to: day.nullable(),
      days: z.number().int(),
      completed: z.number().int(),
      activeDays: z.number().int(),
      minPerDay: z.number().int(),
      maxPerDay: z.number().int(),
      perWeek: z
        .number()
        .openapi({ description: "Mean completions per week." }),
    }),
    p50: forecastPoint,
    p85: forecastPoint,
    p95: forecastPoint,
    probabilityByEnd: z.number().nullable().openapi({
      description:
        "Share of simulated runs finished by the end date (0–1); null without an end date.",
    }),
    beyondHorizon: z.boolean().openapi({
      description:
        "True when a percentile lies past the 730-day horizon (its point is null).",
    }),
    method: z.object({
      name: z.literal("monte_carlo_daily_throughput"),
      iterations: z.number().int(),
      seed: z.number().int(),
      maxDays: z.number().int(),
    }),
  })
  .openapi("DeliveryForecast", {
    description:
      "A Monte Carlo forecast: the project's daily completions over the last 56 days (from its start, if later) are replayed 10,000 times with a seeded generator until the open scope is done. Counts only; no task content.",
  });

const riskSignal = z.object({
  kind: z.enum(RISK_KINDS),
  severity: z.enum(["high", "medium", "low"]),
  taskIds: z.array(z.string()).openapi({
    description: "Affected tasks, at most 20 (see total).",
  }),
  total: z.number().int(),
  headTaskId: z.string().nullable().optional().openapi({
    description:
      "blocked_chain: the task holding the chain up; null when it is in a project you can't see.",
  }),
  assigneeId: z.string().nullable().optional().openapi({
    description:
      "overdue_cluster: the shared first assignee; null for unassigned.",
  }),
  depth: z.number().int().optional(),
  ageDays: z.number().optional(),
  thresholdDays: z.number().optional(),
  deadline: day.optional(),
  finishDate: day.optional().openapi({
    description: "critical_path: the day the chain is expected to finish.",
  }),
});

const riskTask = z.object({
  id: z.string(),
  projectId: z.string(),
  projectSlug: z.string(),
  number: z.number().int().nullable(),
  title: z.string(),
  status: z.string(),
  dueDate: nullableResponseTimestamp,
  assigneeIds: z.array(z.string()),
});

const cycleTimeSchema = z.object({
  samples: z.number().int(),
  p50Days: z.number().nullable(),
  p85Days: z.number().nullable(),
});

export const riskRadarSchema = z
  .object({
    scope: scopeSchema,
    today: day,
    truncated: z.boolean().openapi({
      description: "True when the scope or its blocker graph hit a size cap.",
    }),
    hiddenBlockers: z.number().int().openapi({
      description:
        "Blocking tasks in projects you can't see; they count in chains but are never named. Through a project-limited API key, those outside its projects are left out altogether.",
    }),
    history: z.object({ cycleTime: cycleTimeSchema }),
    criticalPath: z
      .object({
        taskIds: z.array(z.string()),
        hiddenCount: z.number().int(),
        total: z.number(),
        unit: z.enum(["days", "tasks"]),
        finishDate: day.nullable(),
        slackDays: z.number().int().nullable(),
      })
      .nullable(),
    signals: z.array(riskSignal),
    tasks: z.array(riskTask).openapi({
      description: "The tasks the signals and critical path name.",
    }),
  })
  .openapi("RiskRadar", {
    description:
      "Computed risks of an open scope: blocked chains, the critical path to the end date, ageing work (in progress longer than the project's p85 cycle time over the last 90 days, from at least 10 samples), overdue clusters (3+ overdue tasks with one first assignee), and unassigned work due within 3 days. Ordered by severity.",
  });

export const homeRisksSchema = z
  .object({
    today: day,
    cycles: z.number().int().openapi({
      description: "Current cycles looked at (at most 20).",
    }),
    signals: z.array(
      riskSignal.extend({
        projectId: z.string(),
        projectName: z.string(),
        cycleId: z.string(),
        cycleName: z.string(),
      }),
    ),
    tasks: z.array(riskTask),
  })
  .openapi("HomeRisks");
