import { responseTimestamp, z } from "../openapi";
import { ESTIMATE_TYPES } from "./types";

export const estimateTypeSchema = z
  .enum(ESTIMATE_TYPES)
  .openapi("EstimateType", {
    description:
      "points: numbers; categories: labels such as T-shirt sizes; time: whole minutes. Points and time are numeric and can be summed.",
  });

export const estimatePointSchema = z
  .object({
    id: z.string(),
    estimateId: z.string(),
    value: z.string().openapi({
      description:
        'Canonical display text. Time systems hold whole minutes, for example "90".',
    }),
    numericValue: z.number().nullable().openapi({
      description:
        "The value as a number (minutes for time); null for categories.",
    }),
    position: z.number().openapi({
      description:
        "1..n within the system, the sort order. Points and time are ordered by value.",
    }),
    taskCount: z.number().openapi({
      description: "Tasks on this value right now, archived ones included.",
    }),
  })
  .openapi("EstimatePoint");

export const estimateSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    type: estimateTypeSchema,
    isActive: z.boolean().openapi({
      description:
        "At most one system per project is active; tasks only use its values.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    points: z.array(estimatePointSchema).openapi({
      description: "In position order.",
    }),
  })
  .openapi("Estimate");

export const estimateListSchema = z
  .object({
    activeEstimateId: z.string().nullable(),
    estimates: z.array(estimateSchema).openapi({
      description: "The active system first, then the others, newest first.",
    }),
  })
  .openapi("EstimateList");

const groupTotalsSchema = z
  .object({
    taskCount: z.number(),
    estimatedTaskCount: z.number(),
    total: z.number().nullable().openapi({
      description: "Sum of the values; null unless the system is numeric.",
    }),
  })
  .openapi("EstimateGroupTotals");

export const estimateTotalsSchema = z
  .object({
    enabled: z.boolean().openapi({
      description:
        "True when the project's estimates feature is on and a system is active. When false, every count is 0, every sum is null and distribution is empty.",
    }),
    estimateId: z.string().nullable(),
    type: estimateTypeSchema.nullable(),
    isNumeric: z.boolean().openapi({
      description:
        "True for points and time systems. Show sums only then; otherwise fall back to task counts.",
    }),
    taskCount: z.number().openapi({
      description:
        "Visible tasks in scope (not archived, not in triage). Cancelled tasks are included.",
    }),
    estimatedTaskCount: z.number(),
    completedTaskCount: z.number(),
    completedEstimatedTaskCount: z.number(),
    total: z.number().nullable().openapi({
      description:
        "Sum of the values over the scope, rounded to 2 decimals (minutes for time). 0 when nothing is estimated; null for categories.",
    }),
    completed: z.number().nullable().openapi({
      description: "The same sum over the completed group.",
    }),
    byGroup: z
      .object({
        backlog: groupTotalsSchema,
        unstarted: groupTotalsSchema,
        started: groupTotalsSchema,
        completed: groupTotalsSchema,
        cancelled: groupTotalsSchema,
      })
      .openapi("EstimateTotalsByGroup"),
    distribution: z
      .array(
        z
          .object({
            pointId: z.string(),
            value: z.string(),
            position: z.number(),
            taskCount: z.number(),
            completedTaskCount: z.number(),
          })
          .openapi("EstimateDistributionRow"),
      )
      .openapi({
        description:
          "One row per value of the active system in position order, zero counts included.",
      }),
  })
  .openapi("EstimateTotals");

export const estimateDeleteResultSchema = z
  .object({
    deletedEstimateId: z.string(),
    clearedTaskCount: z.number().openapi({
      description: "Tasks left without an estimate (active systems only).",
    }),
  })
  .openapi("EstimateDeleteResult");

export const estimatePointDeleteResultSchema = z
  .object({
    estimate: estimateSchema,
    movedTaskCount: z.number(),
    clearedTaskCount: z.number(),
  })
  .openapi("EstimatePointDeleteResult");

export const estimateActivateResultSchema = z
  .object({
    estimate: estimateSchema,
    previousEstimateId: z.string().nullable().openapi({
      description:
        "The system that was active before the call; the target itself when it already was.",
    }),
    remappedTaskCount: z.number().openapi({
      description: "Tasks moved to a value of the new system.",
    }),
    clearedTaskCount: z.number().openapi({
      description: "Tasks left without an estimate.",
    }),
  })
  .openapi("EstimateActivateResult");

export const ESTIMATE_VALUE_ERROR_CODES = [
  "empty",
  "too_long",
  "not_numeric",
  "numeric_category",
  "not_positive",
  "too_large",
  "too_precise",
  "duplicate",
  "too_few",
  "too_many",
] as const;

export const estimateValidationErrorSchema = z
  .object({
    message: z.string(),
    errors: z.array(
      z
        .object({
          index: z.number().openapi({
            description:
              "The offending value's index in the request, or -1 for the count rules (too_few, too_many).",
          }),
          code: z.enum(ESTIMATE_VALUE_ERROR_CODES),
        })
        .openapi("EstimateValueError"),
    ),
  })
  .openapi("EstimateValidationError");

export const estimatePointInUseSchema = z
  .object({
    message: z.string(),
    taskCount: z.number(),
  })
  .openapi("EstimatePointInUse");
