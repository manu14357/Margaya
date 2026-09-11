import { z } from "../openapi";
import {
  ARCHIVED_FILTERS,
  filterNodeSchema,
  GROUP_BY_KEYS,
  taskQueryOrderBySchema,
} from "../task-query/schema";
import {
  DISPLAY_PROPERTY_FLAGS,
  type DisplayPropertyFlag,
  MAX_VIEW_CUSTOM_FIELD_COLUMNS,
  VIEW_ACCESS,
  VIEW_LAYOUTS,
} from "./types";

// Request schemas. Filters and display reuse the task query engine's schemas,
// so a view can only store what the engine can run; the filter tree's rules
// are then checked with the engine's own validator (validate.ts).

export const MAX_VIEW_NAME_LENGTH = 255;
export const MAX_VIEW_DESCRIPTION_LENGTH = 2000;
export const VIEW_NAME_REQUIRED = "Give the view a name";

export const viewParam = z.object({ id: z.string() });

export const viewFiltersInputSchema = z
  .object({
    version: z.literal(1).optional(),
    root: filterNodeSchema.nullable().optional().openapi({
      description:
        "The task query filter tree (POST /api/task-query `filters`), or null for no filters. Values `me` stay stored as-is and resolve to whoever opens the view.",
    }),
    archived: z.enum(ARCHIVED_FILTERS).optional(),
  })
  .strict()
  .openapi("ViewFiltersInput", {
    description:
      "Omitted fields keep their current value (the default on create). The search text is never stored.",
  });

export const viewDisplayInputSchema = z
  .object({
    layout: z.enum(VIEW_LAYOUTS).optional().openapi({
      description:
        "Workspace views: list, board or spreadsheet. Defaults: list for project views, spreadsheet for workspace views.",
    }),
    groupBy: z.enum(GROUP_BY_KEYS).nullable().optional().openapi({
      description:
        "status only in project views. Default: status for project views, none for workspace views.",
    }),
    subGroupBy: z.enum(GROUP_BY_KEYS).nullable().optional().openapi({
      description: "Needs groupBy and must differ from it.",
    }),
    orderBy: taskQueryOrderBySchema.optional().openapi({
      description:
        "Default: manual for project views, createdAt (newest first) for workspace views.",
    }),
    showSubTasks: z.boolean().optional(),
    showEmptyGroups: z.boolean().optional(),
  })
  .strict()
  .openapi("ViewDisplayInput", {
    description:
      "Omitted fields keep their current value (the default on create).",
  });

const flagShape = Object.fromEntries(
  DISPLAY_PROPERTY_FLAGS.map((flag) => [flag, z.boolean().optional()]),
) as Record<DisplayPropertyFlag, z.ZodOptional<z.ZodBoolean>>;

export const viewDisplayPropertiesInputSchema = z
  .object({
    ...flagShape,
    customFields: z
      .array(z.string().min(1).max(128))
      .max(MAX_VIEW_CUSTOM_FIELD_COLUMNS)
      .optional()
      .openapi({
        description:
          "Custom field ids shown as spreadsheet columns, in order. Project views only; each must be a field of the view's project.",
      }),
  })
  .strict()
  .openapi("ViewDisplayPropertiesInput", {
    description:
      "Which task properties the view shows. Omitted fields keep their current value (the default on create); unknown keys are rejected.",
  });

const viewName = z
  .string()
  .trim()
  .min(1, VIEW_NAME_REQUIRED)
  .max(MAX_VIEW_NAME_LENGTH, "Keep the name under 255 characters");

const viewDescription = z
  .string()
  .max(
    MAX_VIEW_DESCRIPTION_LENGTH,
    "Keep the description under 2,000 characters",
  );

const viewAccess = z.enum(VIEW_ACCESS).openapi({
  description:
    "workspace: every member with view:read sees it. private: only its owner, admins included.",
});

export const createViewBody = z
  .object({
    workspaceId: z.string().min(1),
    projectId: z.string().min(1).optional().openapi({
      description:
        "A project of the workspace with views on. Omitted for a workspace view.",
    }),
    name: viewName,
    description: viewDescription.optional(),
    filters: viewFiltersInputSchema.optional(),
    display: viewDisplayInputSchema.optional(),
    displayProperties: viewDisplayPropertiesInputSchema.optional(),
    access: viewAccess
      .optional()
      .openapi({ description: "Default workspace." }),
  })
  .strict();

export const updateViewBody = z
  .object({
    name: viewName.optional(),
    description: viewDescription.optional(),
    filters: viewFiltersInputSchema.optional(),
    display: viewDisplayInputSchema.optional(),
    displayProperties: viewDisplayPropertiesInputSchema.optional(),
    access: viewAccess.optional(),
  })
  .strict()
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Send at least one field to change",
  });

export const duplicateViewBody = z
  .object({
    name: viewName.optional().openapi({
      description: 'Defaults to "{original name} (copy)".',
    }),
  })
  .strict();

export const listViewsQuery = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional().openapi({
    description:
      "List this project's views. Omitted: the workspace views (views without a project).",
  }),
  mine: z.enum(["true", "false"]).optional().openapi({
    description: "true: only views the caller owns.",
  }),
  search: z.string().trim().max(100).optional().openapi({
    description: "Case-insensitive substring of the view name.",
  }),
});

export const builtInViewsQuery = z.object({ workspaceId: z.string().min(1) });

export type CreateViewInput = z.infer<typeof createViewBody>;
export type UpdateViewInput = z.infer<typeof updateViewBody>;
export type ViewFiltersInput = z.infer<typeof viewFiltersInputSchema>;
export type ViewDisplayInput = z.infer<typeof viewDisplayInputSchema>;
export type ViewDisplayPropertiesInput = z.infer<
  typeof viewDisplayPropertiesInputSchema
>;
