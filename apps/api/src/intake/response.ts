import { COLUMN_GROUPS } from "../column/groups";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { INTAKE_SOURCES, INTAKE_STATUSES } from "./status";

export const intakeStatusSchema = z
  .enum(INTAKE_STATUSES)
  .openapi("IntakeStatus", {
    description:
      "The effective status: a snoozed request whose snooze has passed is pending, even before the wake-up job updates the row. pending and snoozed are open; accepted, declined and duplicate are closed.",
  });

const intakePersonSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("IntakePerson");

const intakeDuplicateSchema = z
  .object({
    taskId: z.string(),
    key: z.string(),
    title: z.string(),
    status: z.string(),
  })
  .openapi("IntakeDuplicateOf");

const intakeTaskSchema = z
  .object({
    id: z.string(),
    projectId: z.string().openapi({
      description:
        "The task's current project. An accepted task may later move to another project; the request stays in the queue it was submitted to.",
    }),
    number: z.number(),
    key: z.string(),
    title: z.string(),
    priority: z.string(),
    status: z.string(),
    columnId: z.string().nullable(),
    columnName: z.string().nullable().openapi({
      description: "Null for the backlog (planned).",
    }),
    group: z.enum(COLUMN_GROUPS).openapi({
      description:
        "triage while the request waits in intake (declined and duplicate requests stay there too), backlog for planned tasks.",
    }),
    assigneeId: z.string().nullable(),
    dueDate: nullableResponseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("IntakeTask");

export const intakeItemSchema = z
  .object({
    id: z.string(),
    projectId: z.string().openapi({
      description: "The project whose queue the request was submitted to.",
    }),
    taskId: z.string(),
    status: intakeStatusSchema,
    snoozedUntil: nullableResponseTimestamp.openapi({
      description: "Set only while the request is snoozed.",
    }),
    source: z.enum(INTAKE_SOURCES),
    resolutionNote: z.string().nullable().openapi({
      description: "The reason given when declining or marking a duplicate.",
    }),
    submittedBy: intakePersonSchema.nullable().openapi({
      description: "Null once the requester's account is deleted.",
    }),
    externalSubmitter: z
      .object({ email: z.string().nullable(), name: z.string().nullable() })
      .nullable()
      .openapi({
        description:
          "The sender of an email or request-form submission, who has no account. Null for requests filed by members or public board visitors.",
      }),
    triagedBy: intakePersonSchema.nullable().openapi({
      description: "Who made the latest triage decision.",
    }),
    triagedAt: nullableResponseTimestamp,
    duplicateOf: intakeDuplicateSchema.nullable().openapi({
      description:
        "The task this request duplicates; null when unset or when that task was deleted.",
    }),
    task: intakeTaskSchema,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("IntakeItem");

export const intakeCountsSchema = z
  .object({
    pending: z.number(),
    snoozed: z.number(),
    accepted: z.number(),
    declined: z.number(),
    duplicate: z.number(),
  })
  .openapi("IntakeCounts", {
    description:
      "Requests per effective status under the visibility, search, priority and submittedBy filters. The tab and status filters are ignored, so tab badges match what switching tabs shows.",
  });

export const intakeItemListSchema = z
  .object({
    items: z.array(intakeItemSchema),
    page: z.number(),
    limit: z.number(),
    total: z.number().openapi({
      description: "Requests matching every filter, the tab included.",
    }),
    hasMore: z.boolean(),
    counts: intakeCountsSchema,
  })
  .openapi("IntakeItemList");

export const intakeSummarySchema = z
  .object({ pending: z.number(), snoozed: z.number() })
  .openapi("IntakeSummary", {
    description: "The project's open requests by effective status.",
  });

export const intakeDeleteResultSchema = z
  .object({ id: z.string(), taskId: z.string(), projectId: z.string() })
  .openapi("IntakeDeleteResult");
