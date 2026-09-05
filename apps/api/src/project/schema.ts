import { z } from "../openapi";

export const projectParam = z.object({ id: z.string() });

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
  })
  .openapi({
    minProperties: 1,
    description:
      "Any subset of the feature flags. Unknown keys are rejected, and at least one flag is required.",
  });
