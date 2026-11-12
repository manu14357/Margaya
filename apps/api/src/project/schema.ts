import { z } from "../openapi";

export const projectParam = z.object({ id: z.string() });

export const projectMemberParam = z.object({
  id: z.string(),
  userId: z.string(),
});

export const projectVisibilitySchema = z.enum(["open", "restricted"]).openapi({
  description:
    "open: reached through workspace roles. restricted: only by project members, and by workspace owners and admins.",
});

const projectRoleField = z.string().min(1).max(64).openapi({
  description:
    "A workspace role name (viewer, member, admin, or a custom role). In a restricted project it caps the member's rights: they get what both roles grant.",
});

export const updateProjectVisibilityBody = z
  .object({ visibility: projectVisibilitySchema })
  .strict();

export const addProjectMemberBody = z
  .object({
    userId: z.string().min(1),
    role: projectRoleField.optional().default("member"),
  })
  .strict();

export const updateProjectMemberBody = z
  .object({ role: projectRoleField })
  .strict();

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const listProjectsQuery = z.object({
  workspaceId: z.string(),
  includeArchived: z.string().optional().openapi({
    description: 'Pass "true" to include archived projects in the list.',
  }),
});

export const createProjectBody = z.object({
  name: z.string(),
  workspaceId: z.string(),
  icon: z.string(),
  slug: z.string(),
  visibility: projectVisibilitySchema.optional().openapi({
    description:
      "Defaults to open. A restricted project starts with its creator as its only member (besides workspace owners and admins).",
  }),
  fromProjectId: z.string().min(1).optional().openapi({
    description:
      "Start from this project of the same workspace: copies its statuses, custom fields, estimate systems, feature toggles, description, lead, default assignee and scheduled automations. Integrations, webhooks, public boards and members are never copied.",
  }),
  copy: z
    .object({
      taskTemplates: z.boolean().optional().openapi({
        description: "Also copy the source's task templates.",
      }),
      openTasks: z.boolean().optional().openapi({
        description:
          "Also copy its open tasks (at most 500; needs task:create) with assignees, labels, custom field values, estimates and sub-task links. Comments, attachments, history, cycles and modules are not copied.",
      }),
    })
    .strict()
    .optional()
    .openapi({ description: "Only with fromProjectId." }),
});

const projectMemberField = (description: string) =>
  z.string().min(1).nullable().optional().openapi({ description });

export const updateProjectBody = z.object({
  name: z.string(),
  icon: z.string(),
  slug: z.string(),
  description: z.string(),
  isPublic: z.boolean(),
  leadUserId: projectMemberField(
    "User id of the project lead; must be a workspace member. null clears it; omit to keep the current lead.",
  ),
  defaultAssigneeUserId: projectMemberField(
    "User id assigned to new tasks that are created without assignees; must be a workspace member. null clears it; omit to keep the current value.",
  ),
});

export const reorderProjectsBody = z.object({
  // Positions express a relative order only; the controller renumbers the
  // workspace to 0..n-1, so the values just have to be sane.
  projects: z
    .array(z.object({ id: z.string(), position: z.number().int().min(0) }))
    .min(1),
});

const featureFlag = (description: string) =>
  z.boolean().optional().openapi({ description });

export const updateProjectFeaturesBody = z
  .strictObject({
    cyclesEnabled: featureFlag("Time-boxed iterations."),
    modulesEnabled: featureFlag("Larger pieces of work grouping tasks."),
    viewsEnabled: featureFlag("Saved project views."),
    pagesEnabled: featureFlag("Project documents."),
    intakeEnabled: featureFlag("The request review queue."),
    estimatesEnabled: featureFlag("Task size estimates."),
    timeTrackingEnabled: featureFlag("Time entries logged on tasks."),
    aiEnabled: featureFlag(
      "AI features for this project (when the workspace has AI on). Off keeps the project out of AI context.",
    ),
    updatesEnabled: featureFlag(
      "Project status updates: a timeline of health and progress posts.",
    ),
  })
  .openapi({
    minProperties: 1,
    description:
      "Any subset of the feature flags. Unknown keys are rejected, and at least one flag is required.",
  });
