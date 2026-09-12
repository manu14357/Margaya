import { z } from "../openapi";
import { VALID_PRIORITIES } from "../task/validate-task-fields";
import { INTAKE_TABS } from "./status";

export const MAX_INTAKE_TITLE = 500;
export const MAX_INTAKE_DESCRIPTION = 50_000;
export const MAX_INTAKE_NOTE = 2_000;

export const projectIdParam = z.object({ projectId: z.string() });

export const taskIdParam = z.object({ taskId: z.string() });

export const intakeItemParam = z.object({ id: z.string() });

const pagingNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "Expected a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const listIntakeQuery = z.object({
  tab: z.enum(INTAKE_TABS).optional().openapi({
    description:
      "open (default): pending and snoozed requests. closed: accepted, declined and duplicate ones.",
  }),
  status: z.string().max(200).optional().openapi({
    description:
      "Comma-separated effective statuses, all from the chosen tab. Defaults to pending on the open tab and to all three on the closed tab.",
  }),
  priority: z.string().max(200).optional().openapi({
    description: "Comma-separated task priorities.",
  }),
  submittedBy: z.string().max(200).optional().openapi({
    description: "`me` or a user id.",
  }),
  search: z.string().trim().max(100).optional().openapi({
    description:
      "Case-insensitive text in the title, or a task key (`WEB-12`) or bare number.",
  }),
  sortBy: z.enum(["createdAt", "updatedAt", "number"]).optional().openapi({
    description:
      "createdAt (default): submission time. updatedAt: the later of the request's and its task's last change. number: the task number.",
  }),
  sortOrder: z.enum(["asc", "desc"]).optional().openapi({
    description: "Defaults to desc.",
  }),
  page: pagingNumber(1, 1_000_000).optional(),
  limit: pagingNumber(1, 100).optional().openapi({
    description: "Page size, 1–100; defaults to 50.",
  }),
});

const title = z.string().trim().min(1).max(MAX_INTAKE_TITLE);
const description = z.string().max(MAX_INTAKE_DESCRIPTION).openapi({
  description: "Markdown, like task descriptions.",
});
const priority = z.enum(VALID_PRIORITIES);

export const createIntakeBody = z
  .object({
    title,
    description: description.optional(),
    priority: priority.optional().openapi({
      description: "Defaults to no-priority.",
    }),
  })
  .strict();

// At least one field is required; the controller answers 400 otherwise.
export const updateIntakeBody = z
  .object({
    title: title.optional(),
    description: description.optional(),
    priority: priority.optional(),
  })
  .strict();

export const acceptIntakeBody = z.object({
  status: z.string().min(1).max(128).openapi({
    description:
      "Where the task goes: the slug of one of the project's board columns, or planned for the backlog.",
  }),
});

const note = z.string().max(MAX_INTAKE_NOTE).optional().openapi({
  description:
    "An optional reason the requester sees, at most 2,000 characters. Blank means none.",
});

export const declineIntakeBody = z.object({ note });

export const snoozeIntakeBody = z.object({
  until: z.string().max(64).openapi({
    description:
      "When the request comes back: an ISO 8601 date-time with an offset or Z, more than a minute and at most 366 days away.",
  }),
});

export const duplicateIntakeBody = z.object({
  duplicateOfTaskId: z.string().min(1).max(64).openapi({
    description:
      "A task on this project's board or backlog (not archived, not in intake).",
  }),
  note,
});
