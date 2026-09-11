import { z } from "../openapi";
import { isValidDateString } from "../utils/calendar-date";
import { MODULE_STATUSES } from "./types";

export const MODULE_LIST_VIEWS = ["active", "archived"] as const;
export type ModuleListView = (typeof MODULE_LIST_VIEWS)[number];

export const MAX_MODULE_TASK_IDS = 200;
export const MAX_TASK_MODULE_CHANGES = 100;
export const MAX_MODULE_MEMBERS = 100;
export const MAX_REORDERED_MODULES = 1000;

export const projectIdParam = z.object({ projectId: z.string() });

export const moduleParam = z.object({ id: z.string() });

export const taskIdParam = z.object({ taskId: z.string() });

export const moduleLinkParam = z.object({ id: z.string(), linkId: z.string() });

export const moduleStatusSchema = z
  .enum(MODULE_STATUSES)
  .openapi("ModuleStatus", {
    description:
      "Set by hand: backlog, planned, in-progress, paused, completed or cancelled.",
  });

const pagingNumber = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "Expected a positive integer")
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

export const listModulesQuery = z.object({
  view: z.enum(MODULE_LIST_VIEWS).optional().openapi({
    description:
      "active (default): modules that are not archived. archived: archived modules only, newest archive first.",
  }),
  status: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(MODULE_STATUSES)))
    .optional()
    .openapi({
      type: "string",
      description:
        "Comma-separated statuses; a module matches when it has any of them.",
    }),
  leadId: z.string().min(1).optional().openapi({
    description: "Only modules led by this user.",
  }),
  memberId: z.string().min(1).optional().openapi({
    description: "Only modules with this user among their members.",
  }),
  search: z.string().trim().max(100).optional().openapi({
    description: "Case-insensitive substring of the module name.",
  }),
});

export const listModuleTasksQuery = z.object({
  page: pagingNumber(1, 1_000_000).optional(),
  limit: pagingNumber(1, 100).optional().openapi({
    type: "string",
    description: "Tasks per page, 1 to 100 (default 50).",
  }),
});

const moduleDate = (label: string) =>
  z
    .string()
    .refine(isValidDateString, { message: `Invalid ${label}` })
    .nullable()
    .optional()
    .openapi({
      type: ["string", "null"],
      format: "date",
      description: `The ${label}: a calendar day (YYYY-MM-DD), no time zone. null clears it.`,
    });

const moduleName = z
  .string()
  .trim()
  .min(1, "Module name is required")
  .max(255, "Module name must be at most 255 characters");

const moduleDescription = z
  .string()
  .max(5000, "Description must be at most 5000 characters")
  .nullable()
  .optional()
  .openapi({
    type: ["string", "null"],
    description: "Plain text. Empty or whitespace is stored as null.",
  });

const leadId = z
  .string()
  .min(1)
  .nullable()
  .optional()
  .openapi({
    type: ["string", "null"],
    description: "A workspace member, or null for no lead.",
  });

const memberIds = z
  .array(z.string().min(1))
  .max(MAX_MODULE_MEMBERS)
  .optional()
  .openapi({
    description:
      "Up to 100 workspace members; duplicates are ignored. On update the list replaces the current members.",
  });

export const createModuleBody = z.object({
  name: moduleName,
  description: moduleDescription,
  status: moduleStatusSchema.optional().openapi({
    description: "Defaults to backlog.",
  }),
  startDate: moduleDate("start date"),
  targetDate: moduleDate("target date"),
  leadId,
  memberIds,
});

export const updateModuleBody = z.object({
  name: moduleName.optional(),
  description: moduleDescription,
  status: moduleStatusSchema.optional(),
  startDate: moduleDate("start date"),
  targetDate: moduleDate("target date"),
  leadId,
  memberIds,
});

export const reorderModulesBody = z.object({
  // Positions express a relative order only; the controller renumbers the
  // project's modules to 0..n-1.
  modules: z
    .array(z.object({ id: z.string(), position: z.number().int().min(0) }))
    .min(1)
    .max(MAX_REORDERED_MODULES),
});

export const moduleTaskIdsBody = z.object({
  taskIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_MODULE_TASK_IDS)
    .openapi({
      description:
        "1 to 200 task ids; duplicates are ignored. Ids that are not visible tasks of the module's project come back as ignored, never as an error.",
    }),
});

const moduleIdList = z
  .array(z.string().min(1).max(64))
  .max(MAX_TASK_MODULE_CHANGES)
  .optional();

export const setTaskModulesBody = z.object({
  addModuleIds: moduleIdList.openapi({
    description: "Up to 100 modules to put the task in.",
  }),
  removeModuleIds: moduleIdList.openapi({
    description: "Up to 100 modules to take the task out of.",
  }),
});

export const createModuleLinkBody = z.object({
  url: z.string().max(4096).openapi({
    description:
      "An http or https URL without a user name or password; https:// is assumed without a scheme. Stored normalized, at most 2048 characters (the same rule as task links).",
  }),
  title: z
    .string()
    .trim()
    .max(255, "Title must be at most 255 characters")
    .nullable()
    .optional(),
});

export const updateModuleLinkBody = z.object({
  url: createModuleLinkBody.shape.url.optional(),
  title: createModuleLinkBody.shape.title.openapi({
    description: "null or an empty string clears the title.",
  }),
});
