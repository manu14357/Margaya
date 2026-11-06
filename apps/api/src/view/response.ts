import { responseTimestamp, z } from "../openapi";
import {
  ARCHIVED_FILTERS,
  filterNodeSchema,
  groupByKeySchema,
  ORDER_DIRECTIONS,
  orderByFieldSchema,
} from "../task-query/schema";
import {
  DISPLAY_PROPERTY_FLAGS,
  type DisplayPropertyFlag,
  VIEW_ACCESS,
  VIEW_LAYOUTS,
} from "./types";

export const viewFiltersSchema = z
  .object({
    version: z.literal(1),
    root: filterNodeSchema.nullable().openapi({
      description:
        "The task query filter tree, or null. Send it as `filters` to POST /api/task-query.",
    }),
    archived: z.enum(ARCHIVED_FILTERS).openapi({
      description: "Send it as `archived` to POST /api/task-query.",
    }),
  })
  .openapi("ViewFilters");

export const viewDisplaySchema = z
  .object({
    layout: z.enum(VIEW_LAYOUTS),
    groupBy: groupByKeySchema.nullable(),
    subGroupBy: groupByKeySchema.nullable(),
    orderBy: z.object({
      field: orderByFieldSchema,
      direction: z.enum(ORDER_DIRECTIONS),
    }),
    showSubTasks: z.boolean(),
    showEmptyGroups: z.boolean(),
  })
  .openapi("ViewDisplay", {
    description:
      "The layout plus the task query `display` options (every field set).",
  });

const flagShape = Object.fromEntries(
  DISPLAY_PROPERTY_FLAGS.map((flag) => [flag, z.boolean()]),
) as Record<DisplayPropertyFlag, z.ZodBoolean>;

export const viewDisplayPropertiesSchema = z
  .object({
    ...flagShape,
    customFields: z.array(z.string()),
  })
  .openapi("ViewDisplayProperties", {
    description:
      "Which task properties the view shows. linkCount and attachmentCount are reserved.",
  });

const viewUserSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("ViewUser");

export const savedViewSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    projectId: z.string().nullable().openapi({
      description: "Null for a workspace view.",
    }),
    name: z.string(),
    description: z.string(),
    filters: viewFiltersSchema,
    display: viewDisplaySchema,
    displayProperties: viewDisplayPropertiesSchema,
    access: z.enum(VIEW_ACCESS),
    isLocked: z.boolean(),
    lockedBy: viewUserSchema.nullable().openapi({
      description: "Who locked it, while it is locked.",
    }),
    ownerId: z.string().nullable(),
    owner: viewUserSchema.nullable(),
    canEdit: z.boolean().openapi({
      description:
        "The caller may edit, lock and unlock it: its owner with view:update, or anyone with view:delete. A lock still blocks edits until unlocked.",
    }),
    canDelete: z.boolean().openapi({
      description:
        "The caller may delete it (same rule as canEdit). A locked view must be unlocked first.",
    }),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("SavedView");

export const savedViewListSchema = z.array(savedViewSchema);

export const deletedViewSchema = z
  .object({ id: z.string(), projectId: z.string().nullable() })
  .openapi("DeletedView");

export const builtInViewSchema = z
  .object({
    key: z.string().openapi({
      description: "all, assigned, created or subscribed.",
    }),
    name: z.string(),
    baseFilter: filterNodeSchema.nullable().openapi({
      description:
        "A fixed condition AND-ed with the view's filters (for example assignee in [me]); not editable.",
    }),
    filters: viewFiltersSchema,
    display: viewDisplaySchema,
    displayProperties: viewDisplayPropertiesSchema,
  })
  .openapi("BuiltInView");

export const builtInViewListSchema = z.array(builtInViewSchema);
