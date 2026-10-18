import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { taskSchema } from "../task/response";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { applyTemplate } from "./apply";
import {
  deletedTemplateSchema,
  taskTemplateListSchema,
  taskTemplateSchema,
} from "./response";
import {
  applyTemplateBody,
  createTemplateBody,
  listTemplatesParam,
  templateParam,
  updateTemplateBody,
} from "./schema";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  TEMPLATE_NOT_FOUND,
  templateScope,
  updateTemplate,
} from "./templates";

// Task templates: managed with project:update, used with task:create. They
// are settings-level data: changes publish project.task_templates_updated,
// which reaches clients as a project refetch hint.

const TAGS = ["Task templates"];

/**
 * Resolves the template in the path (404 when unknown or its project is in
 * the trash), checks workspace access and sets `workspaceId` and
 * `projectId`. Reads the raw param: route middleware runs before validators.
 */
async function templateAccess(c: Context, next: Next) {
  const userId = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const scope = await templateScope(c.req.param("id") ?? "");
  if (!scope) throw new HTTPException(404, { message: TEMPLATE_NOT_FOUND });
  await validateWorkspaceAccess(
    userId,
    scope.workspaceId,
    c.get("apiKey")?.id,
    scope.projectId,
  );
  c.set("workspaceId", scope.workspaceId);
  c.set("projectId", scope.projectId);
  return next();
}

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const listRoute = createRoute({
  method: "get",
  operationId: "listTaskTemplates",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "List task templates",
  description:
    "The project's task templates in their order (at most 50). Stale references are left out of each template.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: { params: listTemplatesParam },
  responses: {
    200: jsonResponse("The templates", taskTemplateListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse("No workspace access, or missing project:read"),
  },
});

const createTemplateRoute = createRoute({
  method: "post",
  operationId: "createTaskTemplate",
  path: "/",
  tags: TAGS,
  summary: "Create a task template",
  description:
    "Adds a template at the end of the project's list. Labels must be workspace labels, assignees workspace members, the column a non-triage column of the project and the estimate a value of its active system. Publishes project.task_templates_updated.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { body: jsonBody(createTemplateBody) },
  responses: {
    200: jsonResponse("The created template", taskTemplateSchema),
    400: errorResponse(
      "Invalid body, an unknown project, column, label or estimate value, or 50 templates already",
    ),
    403: errorResponse(
      "No workspace access, missing project:update, or an assignee who is not a member",
    ),
    409: errorResponse("Another template of the project has this name"),
  },
});

const updateTemplateRoute = createRoute({
  method: "patch",
  operationId: "updateTaskTemplate",
  path: "/{id}",
  tags: TAGS,
  summary: "Update a task template",
  description:
    "Changes any subset of the fields, with the same rules as create. Publishes project.task_templates_updated.",
  middleware: [
    templateAccess,
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: templateParam, body: jsonBody(updateTemplateBody) },
  responses: {
    200: jsonResponse("The template after the change", taskTemplateSchema),
    400: errorResponse(
      "Invalid body, nothing to change, or an unknown column, label or estimate value",
    ),
    403: errorResponse(
      "No workspace access, missing project:update, or an assignee who is not a member",
    ),
    404: errorResponse(TEMPLATE_NOT_FOUND),
    409: errorResponse("Another template of the project has this name"),
  },
});

const deleteTemplateRoute = createRoute({
  method: "delete",
  operationId: "deleteTaskTemplate",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete a task template",
  description:
    "Tasks created from it are not affected. Publishes project.task_templates_updated.",
  middleware: [
    templateAccess,
    requireWorkspacePermission({ project: ["update"] }),
  ] as const,
  request: { params: templateParam },
  responses: {
    200: jsonResponse("The deleted template's id", deletedTemplateSchema),
    403: errorResponse("No workspace access, or missing project:update"),
    404: errorResponse(TEMPLATE_NOT_FOUND),
  },
});

const applyTemplateRoute = createRoute({
  method: "post",
  operationId: "applyTaskTemplate",
  path: "/{id}/apply",
  tags: TAGS,
  summary: "Create a task from a template",
  description:
    "Creates a task with the template's defaults: the title pattern with the typed title merged in, description, column (or `status`), priority, assignees (or the project's default assignee), estimate (while estimates are on) and labels, then its sub-tasks under it. Each goes through the regular task create, with the same events.",
  middleware: [
    templateAccess,
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: { params: templateParam, body: jsonBody(applyTemplateBody) },
  responses: {
    200: jsonResponse(
      "The created task and its sub-task ids",
      taskSchema.extend({ subtaskIds: z.array(z.string()) }),
    ),
    400: errorResponse(
      "Invalid body, an empty title, or a status that is not a column of the project",
    ),
    403: errorResponse(
      "No workspace access, missing task:create, or missing task:update for a template with sub-tasks",
    ),
    404: errorResponse(TEMPLATE_NOT_FOUND),
  },
});

const taskTemplate = apiRouter<
  BaseVariables & { workspaceId: string; projectId: string | null }
>()
  .openapi(listRoute, async (c) =>
    c.json(await listTemplates(c.req.valid("param").projectId), 200),
  )
  .openapi(createTemplateRoute, async (c) =>
    c.json(await createTemplate(c.req.valid("json"), c.get("userId")), 200),
  )
  .openapi(updateTemplateRoute, async (c) =>
    c.json(
      await updateTemplate(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(deleteTemplateRoute, async (c) =>
    c.json(await deleteTemplate(c.req.valid("param").id, c.get("userId")), 200),
  )
  .openapi(applyTemplateRoute, async (c) => {
    const { title, status } = c.req.valid("json");
    const task = await applyTemplate({
      templateId: c.req.valid("param").id,
      title,
      status,
      userId: c.get("userId"),
      canLinkSubtasks: await hasWorkspacePermission(c, { task: ["update"] }),
    });
    return c.json(task, 200);
  });

export default taskTemplate;
