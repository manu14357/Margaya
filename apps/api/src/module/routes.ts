import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  moduleAccess,
  requireModulesFeatureForModule,
  requireModulesFeatureForProject,
  requireModulesFeatureForTask,
} from "./access";
import {
  moduleListSchema,
  moduleSchema,
  moduleTaskMapSchema,
  taskModuleRefListSchema,
} from "./response";
import {
  createModuleBody,
  listModulesQuery,
  projectIdParam,
  reorderModulesBody,
  setTaskModulesBody,
  taskIdParam,
} from "./schema";

// Every route, reads included, answers 403 while the project's modules
// feature is off. Module dates are calendar days; "today" is the server's
// UTC date. Literal first segments (project, task) are registered before the
// {id} routes; see ./module-routes.ts for those.

export const TAGS = ["Modules"];
export const FEATURE_OFF = "the Modules feature is turned off for this project";

export function jsonBody<T>(schema: T) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

export const readModule = [
  moduleAccess(),
  requireWorkspacePermission({ module: ["read"] }),
  requireModulesFeatureForModule,
] as const;

export const updateModuleMiddleware = [
  moduleAccess(),
  requireWorkspacePermission({ module: ["update"] }),
  requireModulesFeatureForModule,
] as const;

const projectModules = (action: "read" | "create" | "update") =>
  [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ module: [action] }),
    requireModulesFeatureForProject,
  ] as const;

export const listModulesRoute = createRoute({
  method: "get",
  operationId: "listModules",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "List modules",
  description:
    "List a project's modules with their counts and progress, by manual order (position, then newest first); the archived view lists the newest archive first. Not paginated; at most 1000 modules.",
  middleware: [...projectModules("read")] as const,
  request: { params: projectIdParam, query: listModulesQuery },
  responses: {
    200: jsonResponse("The project's modules", moduleListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse(
      `No workspace access, missing module:read permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("project"),
  },
});

export const createModuleRoute = createRoute({
  method: "post",
  operationId: "createModule",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Create module",
  description:
    "Create a module at the top of the manual order. The status defaults to backlog; the lead is not added to the members.",
  middleware: [...projectModules("create"), requireEntitlement] as const,
  request: { params: projectIdParam, body: jsonBody(createModuleBody) },
  responses: {
    200: jsonResponse("The created module", moduleSchema),
    400: errorResponse(
      "Invalid body or dates, or a lead or member outside the workspace",
    ),
    403: errorResponse(
      `No workspace access, missing module:create permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("project"),
    409: errorResponse("A module with this name already exists"),
  },
});

export const reorderModulesRoute = createRoute({
  method: "put",
  operationId: "reorderModules",
  path: "/project/{projectId}/reorder",
  tags: TAGS,
  summary: "Reorder modules",
  description:
    "Apply a manual order. Positions express a relative order only; modules left out (archived ones included) keep their rank, and the project's modules are renumbered to 0..n-1.",
  middleware: [...projectModules("update"), requireEntitlement] as const,
  request: { params: projectIdParam, body: jsonBody(reorderModulesBody) },
  responses: {
    200: jsonResponse("The active modules in the new order", moduleListSchema),
    400: errorResponse(
      "Invalid body, duplicate ids, or a module of another project",
    ),
    403: errorResponse(
      `No workspace access, missing module:update permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("project"),
  },
});

export const getModuleTaskMapRoute = createRoute({
  method: "get",
  operationId: "getModuleTaskMap",
  path: "/project/{projectId}/task-map",
  tags: TAGS,
  summary: "Get module task map",
  description:
    "Every (task, module) pair of the project's active modules, for board filters and card chips. Archived tasks are included.",
  middleware: [...projectModules("read")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The task and module pairs", moduleTaskMapSchema),
    403: errorResponse(
      `No workspace access, missing module:read permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("project"),
  },
});

export const getTaskModulesRoute = createRoute({
  method: "get",
  operationId: "getTaskModules",
  path: "/task/{taskId}",
  tags: TAGS,
  summary: "Get task modules",
  description: "The task's active modules, by name.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ module: ["read"] }),
    requireModulesFeatureForTask,
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The task's modules", taskModuleRefListSchema),
    403: errorResponse(
      `No workspace access, missing module:read permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("task"),
  },
});

export const setTaskModulesRoute = createRoute({
  method: "put",
  operationId: "setTaskModules",
  path: "/task/{taskId}",
  tags: TAGS,
  summary: "Set task modules",
  description:
    "Add the task to some active modules of its project and take it out of others. Idempotent. Archived and triage tasks can only leave modules.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ module: ["update"] }),
    requireModulesFeatureForTask,
    requireEntitlement,
  ] as const,
  request: { params: taskIdParam, body: jsonBody(setTaskModulesBody) },
  responses: {
    200: jsonResponse(
      "The task's active modules after the change",
      taskModuleRefListSchema,
    ),
    400: errorResponse(
      "Nothing to change, a module both added and removed, or a module of another project",
    ),
    403: errorResponse(
      `No workspace access, missing module:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown task"),
    409: errorResponse(
      "A module is archived, or an archived or triage task would be added",
    ),
  },
});
