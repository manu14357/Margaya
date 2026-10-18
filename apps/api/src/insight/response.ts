import { ESTIMATE_TYPES } from "../estimate/types";
import { z } from "../openapi";

// Response schemas of the planning insight routes (insight/index.ts).

const days = z.number().openapi({ description: "Days, to a tenth." });

const taskRef = z
  .object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    projectId: z.string(),
  })
  .openapi("InsightTask");

const taskList = z.object({
  total: z.number().int(),
  tasks: z.array(taskRef).openapi({ description: "At most 25." }),
});

const estimateType = z.enum(ESTIMATE_TYPES).nullable();

export const estimateSuggestionSchema = z
  .object({
    status: z.enum(["ok", "insufficient_history", "no_estimate"]).openapi({
      description:
        "no_estimate: estimates are off or no system is active; insufficient_history: fewer than 3 similar completed and estimated tasks.",
    }),
    estimateType,
    suggestion: z
      .object({
        pointId: z.string(),
        value: z.string(),
        share: z.number().openapi({
          description:
            "Share (0..1) of the similar tasks' weight on this value.",
        }),
        matches: z.number().int(),
      })
      .nullable(),
    cycleTime: z
      .object({
        samples: z.number().int(),
        min: days,
        median: days,
        max: days,
      })
      .nullable()
      .openapi({
        description:
          "Actual cycle time (first start to completion) of the similar tasks.",
      }),
    similar: z.array(
      taskRef.extend({
        pointId: z.string(),
        value: z.string(),
        cycleTimeDays: days.nullable(),
        sharedLabels: z.array(z.string()),
      }),
    ),
  })
  .openapi("EstimateSuggestion");

export const estimateCalibrationSchema = z
  .object({
    status: z.enum(["ok", "no_estimate"]),
    estimateType,
    estimateName: z.string().nullable(),
    windowDays: z.number().int(),
    samples: z.number().int(),
    unmeasured: z.number().int().openapi({
      description:
        "Completed, estimated tasks without a visible start (no cycle time).",
    }),
    ordered: z.boolean().nullable().openapi({
      description:
        "Whether bigger estimates really took longer (medians of buckets with 3+ samples never go down); null with fewer than two such buckets.",
    }),
    buckets: z.array(
      z.object({
        id: z.string(),
        value: z.string(),
        position: z.number().int(),
        samples: z.number().int(),
        p25: days.nullable(),
        median: days.nullable(),
        p75: days.nullable(),
        min: days.nullable(),
        max: days.nullable(),
      }),
    ),
  })
  .openapi("EstimateCalibration");

const capacityRange = z
  .object({
    low: z.number(),
    typical: z.number(),
    high: z.number(),
  })
  .openapi("CapacityRange", {
    description:
      "What comparable time held before: 25th percentile, median and 75th percentile.",
  });

export const cycleCapacitySchema = z
  .object({
    cycleId: z.string(),
    plannedDays: z.number().int().nullable(),
    basis: z.enum(["cycles", "throughput", "none"]).openapi({
      description:
        "cycles: up to 6 ended cycles of the project (2 needed); throughput: tasks completed in every window of the cycle's length over the last 56 days; none: not enough history or no dates.",
    }),
    historyCycles: z.number().int(),
    unit: z.enum(["tasks", "points"]),
    estimateType,
    committed: z.object({
      tasks: z.number().int(),
      estimatedTasks: z.number().int(),
      points: z.number().nullable(),
    }),
    capacity: capacityRange.nullable(),
    load: z.number().nullable(),
    percent: z.number().int().nullable().openapi({
      description: "Load as a percent of a usual cycle (the median).",
    }),
    status: z.enum(["ok", "over", "unknown"]),
    deferrals: z
      .array(
        taskRef.omit({ projectId: true }).extend({
          priority: z.string(),
          size: z.number(),
          dependants: z.number().int(),
        }),
      )
      .openapi({
        description:
          "Not-started tasks to move out until the load fits: lowest priority, then fewest dependants first.",
      }),
    members: z
      .array(
        z.object({
          userId: z.string().nullable(),
          name: z.string().nullable(),
          tasks: z.number().int(),
          points: z.number().nullable(),
          typical: z.number().nullable(),
          status: z.enum(["ok", "over", "unknown"]),
        }),
      )
      .nullable()
      .openapi({
        description:
          "Load per assignee against what they usually finished in a cycle; only for people with cycle:update, otherwise null.",
      }),
  })
  .openapi("CycleCapacity");

const blockedEntry = z.object({
  task: taskRef,
  blockers: z.array(taskRef.extend({ open: z.boolean() })),
  hiddenBlockers: z.number().int().openapi({
    description: "Blockers in projects you can't see (counted, not named).",
  }),
});

export const retroFactsSchema = z
  .object({
    cycle: z.object({
      id: z.string(),
      name: z.string(),
      projectId: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      status: z.enum(["draft", "upcoming", "current", "completed"]),
    }),
    generatedAt: z.string(),
    counts: z.object({
      committed: z.number().int(),
      completed: z.number().int(),
      committedCompleted: z.number().int(),
      added: z.number().int(),
      removed: z.number().int(),
      carriedOver: z.number().int(),
      leftOpen: z.number().int(),
      reopened: z.number().int(),
      blocked: z.number().int(),
    }),
    sayDoPercent: z.number().int().nullable().openapi({
      description: "Percent of the work committed at the start that was done.",
    }),
    points: z
      .object({ committed: z.number(), completed: z.number() })
      .nullable(),
    added: taskList,
    removed: taskList,
    carriedOver: taskList,
    leftOpen: taskList,
    reopened: taskList,
    cycleTime: z.object({
      samples: z.number().int(),
      medianDays: days.nullable(),
      projectP85Days: days.nullable(),
      threshold: days.nullable(),
      thresholdKind: z.enum(["project_p85", "cycle_spread"]).nullable(),
      outliers: z.array(taskRef.extend({ days })),
    }),
    blocked: z.array(blockedEntry),
    forecast: z.object({
      p85: z.string().nullable().openapi({
        description:
          "The 85% date of the earliest shared stakeholder brief of the cycle.",
      }),
      madeAt: z.string().nullable(),
      finishedOn: z.string().nullable(),
      endDate: z.string(),
      met: z.boolean().nullable(),
    }),
  })
  .openapi("RetroFacts");

const briefTask = z
  .object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    dueDate: z.string().nullable(),
  })
  .openapi("MyBriefTask");

const limitedList = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    total: z.number().int(),
    items: z.array(item).openapi({ description: "At most 10." }),
  });

export const myBriefSchema = z
  .object({
    generatedAt: z.string(),
    since: z
      .string()
      .openapi({ description: "Changes are counted from here." }),
    today: z.string(),
    timeZone: z.string(),
    dueToday: limitedList(briefTask),
    overdue: limitedList(briefTask),
    mentions: limitedList(
      z.object({
        id: z.string(),
        kind: z.enum(["task", "page"]),
        actorName: z.string().nullable(),
        taskId: z.string().nullable(),
        pageId: z.string().nullable(),
        projectId: z.string().nullable(),
        key: z.string().nullable(),
        title: z.string(),
        createdAt: z.string(),
      }),
    ),
    blocked: limitedList(
      z.object({
        task: briefTask,
        blockers: z.array(
          z.object({ id: z.string(), key: z.string(), title: z.string() }),
        ),
        hiddenBlockers: z.number().int(),
      }),
    ),
    following: limitedList(
      z.object({
        task: briefTask,
        changes: z.number().int(),
        kinds: z.array(
          z.enum([
            "status",
            "comment",
            "assignee",
            "priority",
            "due_date",
            "other",
          ]),
        ),
        lastAt: z.string(),
      }),
    ),
  })
  .openapi("MyBrief");

export const insightCitationSchema = z
  .object({
    key: z.string(),
    taskId: z.string(),
    title: z.string(),
    url: z.string(),
  })
  .openapi("InsightCitation");
