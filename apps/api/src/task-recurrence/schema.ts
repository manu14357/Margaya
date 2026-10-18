import { z } from "../openapi";
import { isValidDateString } from "../utils/calendar-date";
import {
  MAX_RECURRENCE_INTERVAL,
  MAX_RECURRENCE_OCCURRENCES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_TRIGGERS,
} from "./rule";

export const taskIdParam = z.object({ taskId: z.string() });

export const setTaskRecurrenceBody = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES).openapi({
      description: "How often the task repeats.",
    }),
    interval: z
      .number()
      .int()
      .min(1)
      .max(MAX_RECURRENCE_INTERVAL)
      .optional()
      .openapi({
        description:
          "Every this many days, weeks, months or years. Defaults to 1.",
      }),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .optional()
      .openapi({
        description:
          "Weekly only: the days it repeats on, 0 Sunday to 6 Saturday. Defaults to the weekday of the task's date.",
      }),
    monthDay: z.number().int().min(1).max(31).optional().openapi({
      description:
        "Monthly and yearly only: the day of the month, clamped to shorter months. Defaults to the day of the task's date.",
    }),
    trigger: z.enum(RECURRENCE_TRIGGERS).optional().openapi({
      description:
        "completion (default): the next instance is created when this one is completed. schedule: it is created on its date, in the workspace's time zone, whether or not this one is done.",
    }),
    endDate: z
      .string()
      .refine(isValidDateString, {
        message: "Use a real calendar date in YYYY-MM-DD form",
      })
      .nullable()
      .optional()
      .openapi({
        type: ["string", "null"],
        format: "date",
        description:
          "Last day an instance may fall on (inclusive). Leave out or null for no end date.",
      }),
    maxOccurrences: z
      .number()
      .int()
      .min(2)
      .max(MAX_RECURRENCE_OCCURRENCES)
      .nullable()
      .optional()
      .openapi({
        description:
          "Total number of instances, this task included. Leave out or null for no limit. Not together with endDate.",
      }),
  })
  .superRefine((body, ctx) => {
    if (body.weekdays && body.frequency !== "weekly") {
      ctx.addIssue({
        code: "custom",
        path: ["weekdays"],
        message: "weekdays only applies to a weekly repeat",
      });
    }
    if (
      body.monthDay !== undefined &&
      body.frequency !== "monthly" &&
      body.frequency !== "yearly"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["monthDay"],
        message: "monthDay only applies to a monthly or yearly repeat",
      });
    }
    if (body.endDate && body.maxOccurrences) {
      ctx.addIssue({
        code: "custom",
        path: ["maxOccurrences"],
        message: "Choose an end date or a number of times, not both",
      });
    }
  })
  .openapi("SetTaskRecurrenceBody");

export type SetTaskRecurrenceInput = z.infer<typeof setTaskRecurrenceBody>;
