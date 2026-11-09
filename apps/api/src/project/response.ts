import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { boardColumnSchema, boardTaskSchema } from "../task/response";

const featureFlag = (feature: string) =>
  z.boolean().openapi({
    description: `Whether ${feature} is turned on. While off, its routes answer 403 and its data is kept.`,
  });

export const projectSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    slug: z.string().openapi({
      description: "Short prefix used in task identifiers, e.g. KAN-12.",
    }),
    icon: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: responseTimestamp,
    isPublic: z.boolean().nullable().openapi({
      description:
        "When true the project's board is readable without signing in, via /api/public-project/{id}.",
    }),
    archivedAt: nullableResponseTimestamp.openapi({
      description:
        "Non-null once archived; archived projects are hidden by default.",
    }),
    position: z.number().openapi({ description: "Sidebar order, ascending." }),
    lastTaskNumber: z.number().openapi({
      description:
        "Highest task number issued in this project; the next task gets this plus one.",
    }),
    cyclesEnabled: featureFlag("Cycles"),
    modulesEnabled: featureFlag("Modules"),
    viewsEnabled: featureFlag("Project views"),
    pagesEnabled: featureFlag("Pages"),
    intakeEnabled: featureFlag("Intake"),
    estimatesEnabled: featureFlag("Estimates"),
    timeTrackingEnabled: featureFlag("Time tracking"),
    aiEnabled: featureFlag(
      "AI (effective only while the instance and the workspace have AI on)",
    ),
    leadUserId: z.string().nullable().openapi({
      description:
        "The project lead, a workspace member; null when none. Cleared when the member leaves the workspace.",
    }),
    visibility: z.enum(["open", "restricted"]).openapi({
      description:
        "open: reached through workspace roles. restricted: only by its project members, and by workspace owners and admins; anyone else gets 404.",
    }),
    defaultAssigneeUserId: z.string().nullable().openapi({
      description:
        "Assigned to new tasks created without assignees (API create with no assignee field, intake accept, and as a prefill in the web create flows); null when none. Cleared when the member leaves the workspace.",
    }),
  })
  .openapi("Project");

export const projectStatisticsSchema = z
  .object({
    completionPercentage: z.number(),
    totalTasks: z.number(),
    dueDate: nullableResponseTimestamp.openapi({
      description:
        "The soonest due date among the project's open, non-archived tasks.",
    }),
  })
  .openapi("ProjectStatistics", {
    description:
      "completionPercentage is (completed + archived open tasks) / (tasks - cancelled), rounded; 0 with no tasks and 100 when every task is cancelled. Archived tasks keep their column's group. Triage tasks are not counted.",
  });

export const projectListItemSchema = projectSchema
  .extend({
    statistics: projectStatisticsSchema,
    // Legacy, always empty. Fetch the board via GET /task/tasks/{id}.
    archivedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    plannedTasks: z
      .array(boardTaskSchema)
      .openapi({ description: "Always empty." }),
    columns: z
      .array(boardColumnSchema)
      .openapi({ description: "Always empty." }),
  })
  .openapi("ProjectListItem");

export const projectListSchema = z.array(projectListItemSchema);

export const projectMemberSchema = z
  .object({
    userId: z.string(),
    role: z.string().openapi({
      description:
        "Project role: a workspace role name that caps the member's rights in a restricted project.",
    }),
    addedAt: responseTimestamp,
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  })
  .openapi("ProjectMember");

export const projectAccessSchema = z
  .object({
    visibility: z.enum(["open", "restricted"]),
    leadUserId: z.string().nullable(),
    members: z.array(projectMemberSchema),
    canManage: z.boolean().openapi({
      description:
        "Whether the caller may change visibility and members (project:share, or the project lead).",
    }),
  })
  .openapi("ProjectAccess");

export const projectRightsListSchema = z
  .object({
    projects: z.array(
      z.object({
        projectId: z.string(),
        projectRole: z.string().openapi({
          description: "The project role that caps your rights there.",
        }),
        statements: z.record(z.string(), z.array(z.string())).openapi({
          description:
            "What that project role grants, as resource to actions. You may do there what both it and your workspace role grant.",
        }),
      }),
    ),
  })
  .openapi("ProjectRights");

export const projectPersonSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    image: z.string().nullable(),
  })
  .openapi("ProjectPerson");

export const projectPeopleSchema = z.array(projectPersonSchema);
