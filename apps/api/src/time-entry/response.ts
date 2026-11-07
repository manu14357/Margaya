import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const timeEntrySchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    userId: z.string().nullable().openapi({
      description: "Null once the user who logged the time has been removed.",
    }),
    description: z.string().nullable(),
    startTime: responseTimestamp,
    endTime: nullableResponseTimestamp.openapi({
      description: "Null while the timer is still running.",
    }),
    duration: z.number().nullable().openapi({
      description: "Elapsed seconds, filled in once the entry has an endTime.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("TimeEntry");

export const timeEntryListSchema = z.array(
  timeEntrySchema
    .extend({ userName: z.string().nullable() })
    .openapi("TimeEntryWithUser"),
);

export const createdTimeEntrySchema = timeEntrySchema
  .extend({
    stoppedEntries: z
      .array(z.object({ id: z.string(), taskId: z.string() }))
      .openapi({
        description:
          "The caller's running entries that this one stopped. Empty unless the new entry is itself running.",
      }),
  })
  .openapi("CreatedTimeEntry");

export const runningTimeEntrySchema = z
  .object({
    entry: z
      .object({
        id: z.string(),
        taskId: z.string(),
        startTime: responseTimestamp,
        description: z.string().nullable(),
        taskTitle: z.string(),
        taskNumber: z.number().nullable(),
        projectId: z.string(),
        projectSlug: z.string(),
      })
      .nullable()
      .openapi({ description: "Null when no timer is running." }),
  })
  .openapi("RunningTimeEntry");

export const timeReportSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    timeZone: z.string().openapi({
      description: "The zone whose local days the range was read in.",
    }),
    totalSeconds: z.number(),
    entryCount: z.number().openapi({ description: "Finished entries." }),
    runningCount: z.number().openapi({
      description:
        "Entries still running. Their time is not in any total until they stop.",
    }),
    byPerson: z.array(
      z.object({
        userId: z.string().nullable().openapi({
          description:
            "Null for time logged by people no longer in the workspace, counted together.",
        }),
        name: z.string().nullable(),
        image: z.string().nullable(),
        seconds: z.number(),
        entryCount: z.number(),
      }),
    ),
    byProject: z.array(
      z.object({
        projectId: z.string(),
        name: z.string(),
        slug: z.string(),
        icon: z.string().nullable(),
        seconds: z.number(),
        entryCount: z.number(),
      }),
    ),
  })
  .openapi("TimeReport");
