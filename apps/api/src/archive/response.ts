import { responseTimestamp, z } from "../openapi";

const count = z.number().int().nullable();

export const archiveSummarySchema = z
  .object({
    tasks: count.openapi({
      description:
        "Archived tasks (not in triage); null without task:read, so the tab is hidden.",
    }),
    cycles: count.openapi({
      description:
        "Archived cycles; null without cycle:read or when no project in scope has cycles on.",
    }),
    modules: count.openapi({
      description:
        "Archived modules; null without module:read or when no project in scope has modules on.",
    }),
    projects: count.openapi({
      description:
        "Archived projects of the workspace; always null in a project scope.",
    }),
  })
  .openapi("ArchiveSummary");

const entityShape = {
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  projectSlug: z.string(),
  projectIcon: z.string().nullable(),
  archivedAt: responseTimestamp,
  canRestore: z.boolean(),
  canDelete: z.boolean(),
};

const archivedCycleSchema = z
  .object({
    type: z.literal("cycle"),
    ...entityShape,
    details: z.object({
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
    }),
  })
  .openapi("ArchivedCycle");

const archivedModuleSchema = z
  .object({
    type: z.literal("module"),
    ...entityShape,
    details: z.object({
      status: z.string(),
      targetDate: z.string().nullable(),
    }),
  })
  .openapi("ArchivedModule");

const archivedProjectSchema = z
  .object({
    type: z.literal("project"),
    ...entityShape,
    details: z.object({
      taskCount: z.number().int().openapi({
        description: "Every task of the project but triage, archived included.",
      }),
    }),
  })
  .openapi("ArchivedProject");

export const archivedEntitySchema = z
  .discriminatedUnion("type", [
    archivedCycleSchema,
    archivedModuleSchema,
    archivedProjectSchema,
  ])
  .openapi("ArchivedEntity", {
    description:
      "An archived cycle, module or project. For a project, the project fields are its own. canRestore and canDelete tell which owner routes the caller may use.",
  });

export const archivedEntityListSchema = z
  .object({
    items: z.array(archivedEntitySchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    hasMore: z.boolean(),
  })
  .openapi("ArchivedEntityList");
