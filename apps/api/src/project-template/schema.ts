import { z } from "../openapi";
import { PROJECT_FEATURE_KEYS, type ProjectFeature } from "../project/features";
import { CATEGORY_IDS } from "./types";

// Request schemas of the template routes, plus the `template` and `features`
// fields of POST /project (project/schema.ts uses them).

const locale = z.string().max(35).optional().openapi({
  description:
    "BCP 47 language tag for the text, e.g. de-DE. Matched by language; defaults to your saved locale, then Accept-Language, then en-US.",
});

export const createFromTemplateInput = z
  .strictObject({
    id: z.string().min(1).max(64).openapi({
      description: "A template id from GET /project-template.",
    }),
    sampleData: z.boolean().optional().openapi({
      description:
        "Also add the template's example tasks (needs task:create). Default false.",
    }),
    locale,
  })
  .openapi("CreateProjectTemplateInput", {
    description:
      "Start from a built-in template: statuses, labels, fields, views, rules, pages and more are created with the project, in one step. Not together with fromProjectId.",
  });

export const projectFeaturesInput = z
  .strictObject(
    Object.fromEntries(
      PROJECT_FEATURE_KEYS.map((feature) => [feature, z.boolean().optional()]),
    ) as Record<ProjectFeature, z.ZodOptional<z.ZodBoolean>>,
  )
  .openapi("ProjectFeaturesInput", {
    description:
      "Feature switches by name (cycles, modules, views, pages, whiteboards, intake, estimates, timeTracking, ai, updates). They win over the template's or source project's; omitted ones keep the default.",
  });

export const templateCatalogQuery = z.object({
  locale,
  // A known id only: it is echoed into the ETag header.
  category: z.enum(CATEGORY_IDS).optional().openapi({
    description:
      "Only templates in this category (a category id from the catalog).",
  }),
});

export const templateLocaleQuery = z.object({ locale });

export const templateParam = z.object({
  id: z.string().min(1).max(64),
});

export const sampleDataProjectParam = z.object({
  projectId: z.string().min(1),
});

export const applyStarterBody = z
  .strictObject({
    starterId: z.string().min(1).max(64).openapi({
      description: "A starter id from GET /project-template/starters.",
    }),
    sampleData: z.boolean().optional().openapi({
      description:
        "Add up to four example tasks per project (needs task:create). Default false.",
    }),
    locale,
    timezone: z.string().min(1).max(64).optional().openapi({
      description:
        "IANA time zone to set on the workspace first, e.g. Europe/Berlin (needs workspace:manage_settings).",
    }),
  })
  .openapi("ApplyWorkspaceStarterInput");

export const starterWorkspaceParam = z.object({
  workspaceId: z.string().min(1),
});
