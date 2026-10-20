import { z } from "../openapi";
import { isValidDateString } from "../utils/calendar-date";

// Request schemas of the AI build routes: the duplicate check on create and
// "talk to build" (a prompt becomes a proposal the person reviews, then the
// reviewed proposal is created through the ordinary create routes).

export const BUILD_PRIORITIES = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const BUILD_LABEL_COLORS = [
  "gray",
  "dark-gray",
  "purple",
  "teal",
  "green",
  "yellow",
  "orange",
  "pink",
  "red",
] as const;

// Caps keep a proposal reviewable and its creation bounded.
export const BUILD_LIMITS = {
  columns: 8,
  labels: 20,
  cycles: 12,
  modules: 20,
  tasks: 100,
  subtasksPerTask: 15,
  subtasks: 300,
  labelsPerTask: 5,
} as const;

const ref = z.string().trim().min(1).max(40).openapi({
  description:
    "The proposal's own id for a cycle or module, which tasks point to.",
});

const calendarDay = z
  .string()
  .refine(isValidDateString, {
    message: "Use a real calendar date in YYYY-MM-DD form",
  })
  .nullable()
  .openapi({ type: ["string", "null"], format: "date" });

const columnRef = z.string().trim().max(60).nullable().openapi({
  description:
    "An existing or proposed column's name; null puts the task in the first column.",
});

export const buildProposalSchema = z
  .object({
    summary: z.string().max(2000).openapi({
      description: "One or two sentences on what the plan covers.",
    }),
    project: z
      .object({
        name: z.string().trim().min(1).max(120),
        key: z.string().trim().max(8).openapi({
          description:
            "The project key that prefixes task keys; letters and digits.",
        }),
        description: z.string().max(5000),
      })
      .nullable()
      .openapi({
        description:
          "The new project to create, or null to build into the chosen project.",
      }),
    columns: z
      .array(z.object({ name: z.string().trim().min(1).max(60) }))
      .max(BUILD_LIMITS.columns)
      .openapi({
        description:
          "Columns to add to the board; names that already exist are reused.",
      }),
    labels: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(40),
          color: z.enum(BUILD_LABEL_COLORS),
        }),
      )
      .max(BUILD_LIMITS.labels),
    cycles: z
      .array(
        z.object({
          ref,
          name: z.string().trim().min(1).max(255),
          description: z.string().max(10_000),
          startDate: calendarDay,
          endDate: calendarDay,
        }),
      )
      .max(BUILD_LIMITS.cycles),
    modules: z
      .array(
        z.object({
          ref,
          name: z.string().trim().min(1).max(255),
          description: z.string().max(5000),
        }),
      )
      .max(BUILD_LIMITS.modules),
    tasks: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(255),
          description: z.string().max(10_000),
          priority: z.enum(BUILD_PRIORITIES),
          estimate: z.number().min(0).max(1000).nullable().openapi({
            description:
              "Story points; applied when the project uses a points estimate system.",
          }),
          column: columnRef,
          labels: z
            .array(z.string().trim().min(1).max(40))
            .max(BUILD_LIMITS.labelsPerTask),
          cycleRef: ref.nullable(),
          moduleRef: ref.nullable(),
          subtasks: z
            .array(z.object({ title: z.string().trim().min(1).max(255) }))
            .max(BUILD_LIMITS.subtasksPerTask),
        }),
      )
      .max(BUILD_LIMITS.tasks),
  })
  .refine(
    (proposal) =>
      proposal.tasks.reduce((sum, task) => sum + task.subtasks.length, 0) <=
      BUILD_LIMITS.subtasks,
    { message: `At most ${BUILD_LIMITS.subtasks} sub-tasks in all` },
  )
  .openapi("BuildProposal");

export type BuildProposal = z.infer<typeof buildProposalSchema>;

export const duplicateCheckBody = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(255),
  description: z.string().max(4000).optional().openapi({
    description: "The draft's description so far, if any.",
  }),
});

export const buildProposalBody = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional().openapi({
    description: "Build into this project; omit to propose a new project.",
  }),
  prompt: z.string().trim().min(3).max(4000).openapi({
    description:
      'What to build, e.g. "plan a website relaunch for Q4 with 3 sprints".',
  }),
  depth: z.enum(["balanced", "deep"]).optional().openapi({
    description: "deep takes longer and thinks harder. Defaults to balanced.",
  }),
});

export const applyBuildBody = z.object({
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional().openapi({
    description:
      "Create into this project; omit to create the proposal's new project.",
  }),
  proposal: buildProposalSchema,
});
