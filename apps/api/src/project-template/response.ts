import { z } from "../openapi";

// Response schemas of the template routes and the `template` part of the
// created project.

export const appliedTemplateSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    locale: z.string().openapi({
      description: "The locale the template's text was written in.",
    }),
    sampleTaskCount: z.number().int(),
    skipped: z
      .array(
        z.object({
          kind: z.enum(["label", "pageTemplate", "automationRule"]),
          key: z.string(),
          reason: z.enum(["permission", "limit", "deleting"]),
        }),
      )
      .openapi({
        description:
          "Parts not created: labels without label:create (and rules that name them), labels being deleted, page templates beyond the workspace limit.",
      }),
  })
  .openapi("AppliedProjectTemplate");

const countsSchema = z.object({
  statuses: z.number().int(),
  labels: z.number().int(),
  customFields: z.number().int(),
  views: z.number().int(),
  automationRules: z.number().int(),
  taskTemplates: z.number().int(),
  pages: z.number().int(),
  whiteboards: z.number().int(),
  modules: z.number().int(),
  sampleTasks: z.number().int(),
});

export const projectTemplateSummarySchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    categories: z.array(z.string()).openapi({
      description: "Category ids; the first is the primary one.",
    }),
    featured: z.boolean(),
    icon: z.string().openapi({ description: "A project icon name." }),
    name: z.string(),
    pitch: z.string(),
    description: z.string(),
    suggestedKey: z.string(),
    suggestedVisibility: z.enum(["open", "restricted"]),
    counts: countsSchema,
    hasSampleData: z.boolean(),
  })
  .openapi("ProjectTemplateSummary");

export const projectTemplateCategorySchema = z
  .object({
    id: z.string(),
    icon: z.string(),
    name: z.string(),
    description: z.string(),
  })
  .openapi("ProjectTemplateCategory");

export const projectTemplateCatalogSchema = z
  .object({
    revision: z.string().openapi({
      description: "Changes whenever a template does; also the ETag's base.",
    }),
    locale: z.string(),
    categories: z.array(projectTemplateCategorySchema),
    templates: z.array(projectTemplateSummarySchema),
  })
  .openapi("ProjectTemplateCatalog");

export const projectTemplatePreviewSchema = projectTemplateSummarySchema
  .extend({
    projectDescription: z.string().nullable(),
    features: z.record(z.string(), z.boolean()).openapi({
      description: "Feature switches the project starts with.",
    }),
    statuses: z.array(
      z.object({
        name: z.string(),
        group: z.enum([
          "backlog",
          "unstarted",
          "started",
          "completed",
          "cancelled",
          "triage",
        ]),
      }),
    ),
    labels: z.array(z.object({ name: z.string(), color: z.string() })),
    customFields: z.array(
      z.object({
        name: z.string(),
        type: z.enum(["text", "number", "date", "dropdown", "boolean"]),
        required: z.boolean(),
        options: z.array(z.string()).nullable(),
      }),
    ),
    estimate: z
      .object({
        name: z.string(),
        type: z.enum(["points", "categories", "time"]),
        values: z.array(z.string()),
      })
      .nullable(),
    modules: z.array(z.string()),
    taskTemplates: z.array(z.string()),
    views: z.array(z.object({ name: z.string(), layout: z.string() })),
    automations: z.array(
      z.object({
        name: z.string(),
        trigger: z.string(),
        actions: z.array(z.string()),
      }),
    ),
    scheduledAutomations: z.object({
      autoArchive: z.boolean(),
      autoClose: z.boolean(),
      cycleRollover: z.boolean(),
      flowAlerts: z.boolean(),
    }),
    intakeForm: z.boolean().openapi({
      description: "Whether a request form is set up (always created off).",
    }),
    pages: z.array(z.string()),
    whiteboards: z.array(z.string()),
    sampleTasks: z.array(
      z.object({
        title: z.string(),
        status: z.string(),
        priority: z.string(),
        labels: z.array(z.string()),
      }),
    ),
  })
  .openapi("ProjectTemplatePreview");

export const workspaceStarterSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    icon: z.string(),
    name: z.string(),
    description: z.string(),
    projects: z.array(
      z.object({
        templateId: z.string(),
        key: z.string(),
        name: z.string(),
        icon: z.string(),
        visibility: z.enum(["open", "restricted"]),
      }),
    ),
  })
  .openapi("WorkspaceStarter");

export const workspaceStarterListSchema = z
  .object({ starters: z.array(workspaceStarterSchema) })
  .openapi("WorkspaceStarterList");

export const removedSampleDataSchema = z
  .object({
    removedTaskCount: z.number().int(),
    trashBatchId: z.string().nullable().openapi({
      description:
        "The trash batch holding the removed tasks; restoring it brings them back. Null when nothing was left to remove.",
    }),
  })
  .openapi("RemovedSampleData");
