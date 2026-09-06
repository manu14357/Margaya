import { z } from "../openapi";
import { BREAKDOWN_PRIORITIES } from "./progress";

// Response schemas for a planning feature's progress report (see progress.ts).
// Each feature names its own components, e.g. CycleCounts and ModuleCounts,
// so their OpenAPI descriptions stay independent while the shapes match.

export const calendarDaySchema = z.string().openapi({ format: "date" });

export const nullableCalendarDaySchema = z
  .string()
  .nullable()
  .openapi({ type: ["string", "null"], format: "date" });

const breakdownTally = {
  total: z.number(),
  completed: z.number(),
  cancelled: z.number(),
  pending: z.number(),
};

export function progressResponseSchemas(prefix: string) {
  const counts = z
    .object({
      total: z.number(),
      backlog: z.number(),
      unstarted: z.number(),
      started: z.number(),
      completed: z.number(),
      cancelled: z.number(),
    })
    .openapi(`${prefix}Counts`, {
      description:
        "Visible member tasks (not archived, not in triage) per column group.",
    });

  const chart = z
    .object({
      scope: z.number().openapi({
        description: "Tasks in scope: total − cancelled.",
      }),
      days: z.array(
        z
          .object({
            date: calendarDaySchema,
            remaining: z.number().nullable().openapi({
              description:
                "Scope minus tasks completed by that day; null after today.",
            }),
            completed: z.number().nullable().openapi({
              description: "Tasks completed by that day; null after today.",
            }),
            ideal: z.number().openapi({
              description: "The straight burn-down line from scope to 0.",
            }),
          })
          .openapi(`${prefix}ChartDay`),
      ),
    })
    .openapi(`${prefix}Chart`);

  const assignee = z
    .object({
      userId: z.string().nullable().openapi({
        description:
          "Null for unassigned tasks (listed last). A task with several assignees counts in each of their rows.",
      }),
      name: z.string().nullable(),
      image: z.string().nullable(),
      ...breakdownTally,
    })
    .openapi(`${prefix}AssigneeBreakdown`);

  const label = z
    .object({
      name: z.string().nullable().openapi({
        description:
          "Null for tasks without labels (listed last). A task with several labels counts in each.",
      }),
      color: z.string().nullable(),
      ...breakdownTally,
    })
    .openapi(`${prefix}LabelBreakdown`);

  const priority = z
    .object({ priority: z.enum(BREAKDOWN_PRIORITIES), ...breakdownTally })
    .openapi(`${prefix}PriorityBreakdown`);

  return { counts, chart, assignee, label, priority };
}
