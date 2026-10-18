import { responseTimestamp, z } from "../openapi";
import { RECURRENCE_FREQUENCIES, RECURRENCE_TRIGGERS } from "./rule";

const calendarDate = (description: string) =>
  z.string().openapi({ format: "date", description });

const nullableCalendarDate = (description: string) =>
  z
    .string()
    .nullable()
    .openapi({ type: ["string", "null"], format: "date", description });

export const taskRecurrenceSchema = z
  .object({
    taskId: z.string().openapi({
      description: "The series' current instance, which holds the rule.",
    }),
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.number().int(),
    weekdays: z.array(z.number().int()).openapi({
      description:
        "Weekly: the days it repeats on (0 Sunday to 6 Saturday). Empty for other frequencies.",
    }),
    monthDay: z.number().int().nullable().openapi({
      description: "Monthly and yearly: the day of the month.",
    }),
    trigger: z.enum(RECURRENCE_TRIGGERS),
    anchorDate: calendarDate(
      "The current instance's occurrence date in the workspace's time zone; the pattern counts from it.",
    ),
    endDate: nullableCalendarDate("Last day an instance may fall on."),
    maxOccurrences: z.number().int().nullable(),
    occurrenceCount: z.number().int().openapi({
      description: "Instances so far, the first task included.",
    }),
    nextDate: nullableCalendarDate(
      "The next instance's date: when the schedule creates it, or the date it gets if this one is completed today. Null once the series has ended.",
    ),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("TaskRecurrence");

export const taskRecurrenceResultSchema = z
  .object({
    recurrence: taskRecurrenceSchema.nullable().openapi({
      description: "The task's repeat rule, or null when it does not repeat.",
    }),
  })
  .openapi("TaskRecurrenceResult");
