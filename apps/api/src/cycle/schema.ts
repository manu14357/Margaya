import { z } from "../openapi";
import { isValidDateString } from "../utils/calendar-date";

export const CYCLE_LIST_VIEWS = [
  "all",
  "current",
  "upcoming",
  "draft",
  "completed",
  "incomplete",
  "archived",
] as const;

export type CycleListView = (typeof CYCLE_LIST_VIEWS)[number];

export const MAX_CYCLE_TASK_IDS = 200;

export const projectIdParam = z.object({ projectId: z.string() });

export const cycleParam = z.object({ id: z.string() });

export const taskIdParam = z.object({ taskId: z.string() });

export const listCyclesQuery = z.object({
  view: z.enum(CYCLE_LIST_VIEWS).optional().openapi({
    description:
      "all (default): every non-archived cycle. current, upcoming, draft, completed: non-archived cycles with that status. incomplete: current, upcoming and draft. archived: archived cycles only, newest archive first.",
  }),
  search: z.string().trim().max(100).optional().openapi({
    description: "Case-insensitive substring of the cycle name.",
  }),
});

const cycleDate = z
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
      "An inclusive calendar day (YYYY-MM-DD), no time zone. Send startDate and endDate together, both set or both null (a draft).",
  });

const cycleName = z.string().trim().min(1).max(255);
const cycleDescription = z.string().max(10_000);

export const createCycleBody = z.object({
  name: cycleName,
  description: cycleDescription.optional(),
  startDate: cycleDate,
  endDate: cycleDate,
  ownerId: z.string().optional().openapi({
    description: "A workspace member. Defaults to the caller.",
  }),
});

export const updateCycleBody = z.object({
  name: cycleName.optional(),
  description: cycleDescription.optional(),
  startDate: cycleDate,
  endDate: cycleDate,
  ownerId: z.string().nullable().optional().openapi({
    description: "A workspace member, or null to clear the owner.",
  }),
  sortOrder: z.number().optional().openapi({
    description:
      "Manual order hint, ascending; the only field a completed cycle accepts.",
  }),
});

export const taskIdsBody = z.object({
  taskIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_CYCLE_TASK_IDS)
    .openapi({
      description:
        "1 to 200 task ids; duplicates are ignored. Ids that are not visible tasks of the cycle's project come back as ignored, never as an error.",
    }),
});

export const setTaskCycleBody = z.object({
  cycleId: z.string().nullable().openapi({
    description: "The target cycle, or null to take the task out of its cycle.",
  }),
});

export const transferBody = z.object({
  targetCycleId: z.string().min(1),
});
