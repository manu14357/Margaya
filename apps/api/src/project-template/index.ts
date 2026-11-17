import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
  z,
} from "../openapi";
import { createdProjectSchema } from "../project/response";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  CATALOG_REVISION,
  catalogFor,
  findTemplate,
  previewFor,
} from "./catalog";
import { requestLocale, TEMPLATE_NOT_FOUND } from "./create";
import {
  projectTemplateCatalogSchema,
  projectTemplatePreviewSchema,
  removedSampleDataSchema,
  workspaceStarterListSchema,
} from "./response";
import { removeSampleData } from "./sample";
import {
  applyStarterBody,
  sampleDataProjectParam,
  starterWorkspaceParam,
  templateCatalogQuery,
  templateLocaleQuery,
  templateParam,
} from "./schema";
import { starterSummaries } from "./starters";

// Authorization: creating a project from a template (POST /project with
// `template`, or with `features`) needs only project:create. The setup a
// template writes (statuses, views, rules, pages, modules, feature switches)
// is part of creating the project, the same precedent as starting from an
// existing project with fromProjectId. New workspace labels need
// label:create (without it only existing labels are used, the rest are
// skipped) and example tasks need task:create.

const TAGS = ["Project templates"];
const CACHE_CONTROL = "private, max-age=3600";

const notModified = {
  description: "Unchanged since the ETag sent in If-None-Match",
};

const listRoute = createRoute({
  method: "get",
  operationId: "listProjectTemplates",
  path: "/",
  tags: TAGS,
  summary: "List project templates",
  description:
    "The built-in template gallery: categories and template summaries, with their text in the requested language. Any signed-in caller or API key may read it. Answers 304 for a matching If-None-Match.",
  request: { query: templateCatalogQuery },
  responses: {
    200: jsonResponse("The catalog", projectTemplateCatalogSchema),
    304: notModified,
    400: errorResponse("Unknown category"),
  },
});

const startersRoute = createRoute({
  method: "get",
  operationId: "listWorkspaceStarters",
  path: "/starters",
  tags: TAGS,
  summary: "List workspace starters",
  description:
    "Sets of up to five templates a new, empty workspace can create in one step (POST /workspace/{workspaceId}/starter).",
  request: { query: templateLocaleQuery },
  responses: {
    200: jsonResponse("The starters", workspaceStarterListSchema),
  },
});

const getRoute = createRoute({
  method: "get",
  operationId: "getProjectTemplate",
  path: "/{id}",
  tags: TAGS,
  summary: "Get project template",
  description:
    "What a template creates, resolved in the requested language: statuses with their groups, labels, fields, views, rules, pages, feature switches, whether it sets up a request form, and its example tasks.",
  request: { params: templateParam, query: templateLocaleQuery },
  responses: {
    200: jsonResponse("The template preview", projectTemplatePreviewSchema),
    304: notModified,
    404: errorResponse(TEMPLATE_NOT_FOUND),
  },
});

const removeSampleDataRoute = createRoute({
  method: "post",
  operationId: "removeProjectSampleData",
  path: "/project/{projectId}/remove-sample-data",
  tags: TAGS,
  summary: "Remove example tasks",
  description:
    "Moves the example tasks a template added, those still in this project, to the trash as one batch; restoring that batch brings them back. Only the recorded example tasks are trashed: sub-tasks the team added under an example, and examples moved to another project, stay. Allowed with task:delete, or with task:create for the person who created the project from the template (checked against their current role and API key scope). Calling it again changes nothing.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireEntitlement,
  ] as const,
  request: { params: sampleDataProjectParam },
  responses: {
    200: jsonResponse("What was removed", removedSampleDataSchema),
    403: errorResponse(
      "No workspace access, or neither task:delete nor the creator of the project holding task:create",
    ),
    404: lookupNotFound("project"),
  },
});

// Every part is a known catalog value (a resolved locale, a category id from
// the enum, a template id that was found), never raw request text.
function etagFor(locale: string, id?: string) {
  return `"${CATALOG_REVISION}-${locale}${id ? `-${id}` : ""}"`;
}

const projectTemplate = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    const locale = await requestLocale(c, query.locale);
    const etag = etagFor(
      locale,
      query.category ? `c:${query.category}` : undefined,
    );
    c.header("ETag", etag);
    c.header("Cache-Control", CACHE_CONTROL);
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    const catalog = catalogFor(locale);
    return c.json(
      query.category
        ? {
            ...catalog,
            templates: catalog.templates.filter((template) =>
              template.categories.some(
                (category) => category === query.category,
              ),
            ),
          }
        : catalog,
      200,
    );
  })
  .openapi(startersRoute, async (c) => {
    const locale = await requestLocale(c, c.req.valid("query").locale);
    return c.json({ starters: starterSummaries(locale) }, 200);
  })
  .openapi(getRoute, async (c) => {
    const { id } = c.req.valid("param");
    const template = findTemplate(id);
    if (!template)
      throw new HTTPException(404, { message: TEMPLATE_NOT_FOUND });
    const locale = await requestLocale(c, c.req.valid("query").locale);
    const etag = etagFor(locale, id);
    c.header("ETag", etag);
    c.header("Cache-Control", CACHE_CONTROL);
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.json(previewFor(template, locale), 200);
  })
  .openapi(removeSampleDataRoute, async (c) => {
    const result = await removeSampleData({
      projectId: c.req.valid("param").projectId,
      userId: c.get("userId"),
      canDeleteTasks: await hasWorkspacePermission(c, { task: ["delete"] }),
      canCreateTasks: await hasWorkspacePermission(c, { task: ["create"] }),
    });
    return c.json(result, 200);
  });

export default projectTemplate;

// POST /workspace/{workspaceId}/starter, mounted on the workspace router.
export const applyStarterRoute = createRoute({
  method: "post",
  operationId: "applyWorkspaceStarter",
  path: "/{workspaceId}/starter",
  tags: TAGS,
  summary: "Apply a workspace starter",
  description:
    "Creates every project of a starter (GET /project-template/starters) in one step, only in a workspace without projects: any project counts, including restricted projects the caller cannot see, so a workspace with one answers 409. Labels are shared between the projects. Needs project:create; the statuses, views, rules, pages and modules each template writes are part of creating its project. New workspace labels need label:create (without it only existing ones are used), example tasks need task:create and a time zone needs workspace:manage_settings.",
  middleware: [
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ project: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: starterWorkspaceParam,
    body: {
      required: true,
      content: { "application/json": { schema: applyStarterBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The created projects, in order",
      z
        .object({ projects: z.array(createdProjectSchema) })
        .openapi("AppliedWorkspaceStarter"),
    ),
    400: errorResponse("Invalid body or an unknown time zone"),
    403: errorResponse(
      "No workspace access, missing project:create, task:create for example tasks, or workspace:manage_settings for the time zone",
    ),
    404: errorResponse("Unknown starter"),
    409: errorResponse(
      "The workspace already has projects (any project, visible to the caller or not)",
    ),
  },
});
