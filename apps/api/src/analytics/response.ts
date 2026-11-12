import { z } from "../openapi";
import {
  analyticsChartMetricSchema,
  analyticsDateBucketSchema,
  analyticsDimensionSchema,
  analyticsMetricSchema,
} from "./schema";

// Analytics responses (B8 §3.4). Keys are strings the web resolves through
// `meta` and i18n; `none` is the no-value bucket and `other` the folded
// segments. Meta never carries emails.

const day = z
  .string()
  .openapi({ description: "YYYY-MM-DD", example: "2026-03-02" });
const nullableDay = z
  .string()
  .nullable()
  .openapi({ description: "YYYY-MM-DD or null" });

const groupCountsFields = {
  total: z.number().int(),
  backlog: z.number().int(),
  unstarted: z.number().int(),
  started: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
};

export const analyticsGroupCountsSchema = z
  .object(groupCountsFields)
  .openapi("AnalyticsGroupCounts");

const metaUser = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable(),
});

const metaProject = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
});

const projectsMeta = z
  .object({ projects: z.array(metaProject) })
  .openapi("AnalyticsProjectsMeta");

export const analyticsMetaSchema = z
  .object({
    users: z.array(metaUser),
    projects: z.array(metaProject),
    columns: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        icon: z.string().nullable(),
        group: z.string(),
        position: z.number().int(),
      }),
    ),
    labels: z.array(
      z.object({ key: z.string(), name: z.string(), color: z.string() }),
    ),
    cycles: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        status: z.enum(["draft", "upcoming", "current", "completed"]),
        startDate: nullableDay,
        endDate: nullableDay,
      }),
    ),
    modules: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        status: z.string(),
      }),
    ),
    estimates: z.array(
      z.object({
        key: z.string(),
        type: z.enum(["points", "time", "categories"]),
        value: z.string(),
      }),
    ),
    customFields: z
      .array(z.object({ id: z.string(), name: z.string(), type: z.string() }))
      .openapi({
        description:
          "The custom fields the chart groups by or sums, by name. A dropdown's keys are value:<option>, so the option text needs no lookup.",
      }),
  })
  .openapi("AnalyticsMeta", {
    description: "Display data for the returned keys only.",
  });

export const analyticsBucketSchema = z
  .object({
    key: z.string().openapi({
      description:
        "The dimension key: an id, a slug, `name:<label>`, `<type>:<value>` for estimates, `value:<option>` for a custom field, a bucket start day for dates, or `none`.",
    }),
    value: z.number().openapi({
      description:
        "Distinct tasks (or their summed points or number field) holding this key; each task once.",
    }),
    taskCount: z.number().int(),
    cells: z.record(z.string(), z.number()).optional().openapi({
      description:
        "Segment key to value, zeros omitted. With a many-valued segment the cells can sum to more than value.",
    }),
    progress: z.number().int().nullable().openapi({
      description:
        "Completed ÷ (all − cancelled), when the segment is group; null otherwise.",
    }),
    rangeStart: day.optional(),
    rangeEnd: day.optional(),
  })
  .openapi("AnalyticsBucket");

export const analyticsSegmentSchema = z
  .object({
    key: z.string().openapi({
      description: "A segment key, `other` for folded segments, or `none`.",
    }),
    value: z.number(),
    taskCount: z.number().int(),
  })
  .openapi("AnalyticsSegment");

export const analyticsChartResultSchema = z
  .object({
    xAxis: analyticsDimensionSchema,
    segment: analyticsDimensionSchema.nullable(),
    metric: analyticsChartMetricSchema,
    dateBucket: analyticsDateBucketSchema.nullable(),
    today: day,
    totalCount: z.number().int().openapi({
      description: "Distinct tasks in the set; never the sum of the buckets.",
    }),
    totalValue: z.number(),
    progress: z.number().int().nullable().openapi({
      description:
        "Completion % when the x-axis or segment is group (cancelled work excluded); null otherwise.",
    }),
    noneCount: z.number().int().nullable().openapi({
      description:
        "With includeNone false: the tasks of the hidden none bucket. Null otherwise.",
    }),
    buckets: z.array(analyticsBucketSchema),
    segments: z.array(analyticsSegmentSchema),
    truncated: z.object({
      x: z.boolean(),
      hiddenXCount: z.number().int(),
      segment: z.boolean(),
      hiddenSegmentCount: z.number().int(),
    }),
    multiValued: z.object({ x: z.boolean(), segment: z.boolean() }),
    pointsProjectIds: z.array(z.string()),
    meta: analyticsMetaSchema,
  })
  .openapi("AnalyticsChartResult");

export const analyticsTrendResultSchema = z
  .object({
    from: day,
    to: day,
    bucket: analyticsDateBucketSchema,
    metric: analyticsMetricSchema,
    today: day,
    series: z.array(
      z.object({
        start: day,
        rangeStart: day,
        rangeEnd: day,
        created: z.number(),
        completed: z.number(),
      }),
    ),
    totals: z.object({
      created: z.number(),
      completed: z.number(),
      net: z.number(),
    }),
    pointsProjectIds: z.array(z.string()),
  })
  .openapi("AnalyticsTrendResult");

const taskNumbersFields = {
  ...groupCountsFields,
  progress: z.number().int(),
  overdue: z.number().int(),
};

export const analyticsOverviewSchema = z
  .object({
    today: day,
    members: z.object({
      total: z.number().int(),
      byRole: z.array(z.object({ role: z.string(), count: z.number().int() })),
    }),
    projects: z.object({
      total: z.number().int(),
      withFeature: z.object({
        cycles: z.number().int(),
        modules: z.number().int(),
        intake: z.number().int(),
        estimates: z.number().int(),
      }),
    }),
    tasks: z.object(taskNumbersFields),
    projectRows: z.array(
      z.object({ projectId: z.string(), ...taskNumbersFields }),
    ),
    cycles: z
      .object({
        draft: z.number().int(),
        upcoming: z.number().int(),
        current: z.number().int(),
        completed: z.number().int(),
      })
      .nullable(),
    modules: z
      .object({
        total: z.number().int(),
        byStatus: z.record(z.string(), z.number().int()),
      })
      .nullable(),
    intake: z
      .object({
        open: z.number().int(),
        accepted: z.number().int(),
        declined: z.number().int(),
        duplicate: z.number().int(),
      })
      .nullable(),
    meta: projectsMeta,
  })
  .openapi("AnalyticsOverview");

const planningPointsFields = {
  committedPoints: z.number().nullable(),
  completedPoints: z.number().nullable(),
};

export const analyticsCycleRowSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    status: z.enum(["draft", "upcoming", "current", "completed"]),
    startDate: nullableDay,
    endDate: nullableDay,
    isFrozen: z.boolean(),
    counts: analyticsGroupCountsSchema,
    committed: z.number().int(),
    pending: z.number().int(),
    progress: z.number().int(),
    ...planningPointsFields,
  })
  .openapi("AnalyticsCycleRow");

export const analyticsVelocityPointSchema = z
  .object({
    cycleId: z.string(),
    name: z.string(),
    startDate: nullableDay,
    endDate: nullableDay,
    committed: z.number().int(),
    completed: z.number().int(),
    ...planningPointsFields,
  })
  .openapi("AnalyticsVelocityPoint");

export const analyticsCyclesSchema = z
  .object({
    today: day,
    enabledProjectIds: z.array(z.string()),
    summary: z.object({
      current: z.number().int(),
      upcoming: z.number().int(),
      draft: z.number().int(),
      completedRecent: z.number().int(),
    }),
    rows: z.array(analyticsCycleRowSchema),
    velocity: z.array(analyticsVelocityPointSchema).nullable(),
    averageCompleted: z.number().nullable(),
    averageCompletedPoints: z.number().nullable(),
    meta: projectsMeta,
  })
  .openapi("AnalyticsCycles");

export const analyticsModuleRowSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    status: z.string(),
    leadId: z.string().nullable(),
    startDate: nullableDay,
    targetDate: nullableDay,
    isOverdue: z.boolean(),
    counts: analyticsGroupCountsSchema,
    committed: z.number().int(),
    pending: z.number().int(),
    progress: z.number().int(),
    ...planningPointsFields,
  })
  .openapi("AnalyticsModuleRow");

export const analyticsModulesSchema = z
  .object({
    today: day,
    enabledProjectIds: z.array(z.string()),
    summary: z.object({
      byStatus: z.record(z.string(), z.number().int()),
      overdue: z.number().int(),
    }),
    rows: z.array(analyticsModuleRowSchema),
    meta: z.object({
      projects: z.array(metaProject),
      users: z.array(metaUser),
    }),
  })
  .openapi("AnalyticsModules");

const intakeStatusCounts = {
  pending: z.number().int(),
  snoozed: z.number().int(),
  accepted: z.number().int(),
  declined: z.number().int(),
  duplicate: z.number().int(),
};

export const analyticsIntakeSchema = z
  .object({
    today: day,
    from: day,
    to: day,
    bucket: analyticsDateBucketSchema,
    enabledProjectIds: z.array(z.string()),
    counts: z.object(intakeStatusCounts),
    series: z.array(
      z.object({
        start: day,
        rangeStart: day,
        rangeEnd: day,
        submitted: z.number().int(),
        accepted: z.number().int(),
        declined: z.number().int(),
        duplicate: z.number().int(),
      }),
    ),
    medianHoursToTriage: z.number().nullable(),
    bySource: z.object({
      in_app: z.number().int(),
      api: z.number().int(),
      public_board: z.number().int(),
      email: z.number().int(),
      form: z.number().int(),
    }),
    byProject: z
      .array(
        z.object({
          projectId: z.string(),
          ...intakeStatusCounts,
          medianHoursToTriage: z.number().nullable(),
        }),
      )
      .nullable(),
    meta: projectsMeta,
  })
  .openapi("AnalyticsIntake");

const workloadUnit = z.enum(["tasks", "points"]);

export const analyticsWorkloadSchema = z
  .object({
    unit: workloadUnit.openapi({
      description:
        "points when a scope project has a points system and most open tasks are sized; otherwise tasks. load and cells are in this unit.",
    }),
    usualDays: z.number().int().openapi({
      description: "The span a person's usual covers, in days.",
    }),
    historyDays: z.number().int().openapi({
      description: "The completed work the usual is read from, in days.",
    }),
    members: z.array(
      z.object({
        userId: z.string().nullable().openapi({
          description: "The assignee; null for unassigned work, listed last.",
        }),
        tasks: z.number().int().openapi({ description: "Open tasks." }),
        points: z.number().openapi({
          description: "Estimate points of the open tasks.",
        }),
        load: z.number().openapi({ description: "Open work in unit." }),
        cells: z.object({
          backlog: z.number(),
          unstarted: z.number(),
          started: z.number(),
        }),
        check: z
          .object({
            unit: workloadUnit.openapi({
              description:
                "tasks for a person whose own open work is mostly unsized, whatever the team's unit.",
            }),
            load: z.number(),
            usual: z.number().nullable().openapi({
              description:
                "What they finished in a usual span, from the history; null without history.",
            }),
            status: z.enum(["ok", "over", "unknown"]).openapi({
              description:
                "over when load is above usual; unknown without history, never over.",
            }),
          })
          .nullable()
          .openapi({
            description:
              "Load against the person's own usual. Null for unassigned work and for callers without cycle:update.",
          }),
      }),
    ),
    meta: z.object({ users: z.array(metaUser) }),
  })
  .openapi("AnalyticsWorkload");

export type AnalyticsChartResult = z.infer<typeof analyticsChartResultSchema>;
export type AnalyticsMeta = z.infer<typeof analyticsMetaSchema>;
export type AnalyticsWorkload = z.infer<typeof analyticsWorkloadSchema>;
export type AnalyticsTrendResult = z.infer<typeof analyticsTrendResultSchema>;
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;
export type AnalyticsCycles = z.infer<typeof analyticsCyclesSchema>;
export type AnalyticsCycleRow = z.infer<typeof analyticsCycleRowSchema>;
export type AnalyticsVelocityPoint = z.infer<
  typeof analyticsVelocityPointSchema
>;
export type AnalyticsModules = z.infer<typeof analyticsModulesSchema>;
export type AnalyticsModuleRow = z.infer<typeof analyticsModuleRowSchema>;
export type AnalyticsIntake = z.infer<typeof analyticsIntakeSchema>;
