import type { Context } from "hono";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  requireViewsFeatureForView,
  viewAccess,
  viewProjectScope,
} from "./access";
import { listBuiltInViews } from "./built-in";
import createView from "./controllers/create-view";
import deleteView from "./controllers/delete-view";
import duplicateView from "./controllers/duplicate-view";
import listViews from "./controllers/list-views";
import setViewLock from "./controllers/lock-view";
import { getViewResponse, type ViewCaller } from "./controllers/shared";
import updateView from "./controllers/update-view";
import {
  builtInViewListSchema,
  deletedViewSchema,
  savedViewListSchema,
  savedViewSchema,
} from "./response";
import {
  builtInViewsQuery,
  createViewBody,
  duplicateViewBody,
  listViewsQuery,
  updateViewBody,
  viewParam,
} from "./schema";

// Saved views: a project's (gated by its views feature) or the workspace's
// (never gated). Private views are visible to their owner only, admins
// included, and answer 404 to everyone else. Editing, locking and deleting
// need the owner with view:update, or view:delete.

const TAGS = ["Views"];
const FEATURE_OFF = "the Views feature is turned off for the view's project";
const NOT_FOUND = "Unknown view, or another user's private view";

function jsonBody<T>(schema: T) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

const manageView = [
  viewAccess(),
  requireWorkspacePermission({ view: ["update"] }),
  requireViewsFeatureForView,
] as const;

const listViewsRoute = createRoute({
  method: "get",
  operationId: "listViews",
  path: "/",
  tags: TAGS,
  summary: "List views",
  description:
    "The views the caller can see: shared ones plus their own private ones, of one project (projectId) or of the workspace (views without a project). Ordered by name (natural, case-insensitive), then newest first; at most 1000. Private views whose owner's account is gone are deleted first.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ view: ["read"] }),
    viewProjectScope("query"),
  ] as const,
  request: { query: listViewsQuery },
  responses: {
    200: jsonResponse("The views", savedViewListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse(
      "No workspace access, missing view:read permission, or the project's Views feature is off",
    ),
    404: errorResponse("The project is not in the workspace"),
  },
});

const createViewRoute = createRoute({
  method: "post",
  operationId: "createView",
  path: "/",
  tags: TAGS,
  summary: "Create view",
  description:
    "Save filters, display options and shown properties as a view owned by the caller, for a project (projectId) or the whole workspace. Missing parts get the defaults. Filters must pass the task query engine's validation, and every id they name must exist in the workspace (cycles, modules, estimate points, custom fields and statuses: in the view's project). Workspace views can't use status (filter or grouping) and use the list, board, spreadsheet or gantt layout.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ view: ["create"] }),
    viewProjectScope("body"),
    requireEntitlement,
  ] as const,
  request: { body: jsonBody(createViewBody) },
  responses: {
    200: jsonResponse("The created view", savedViewSchema),
    400: errorResponse(
      "Invalid body, a missing name, filters the engine can't run, a filter naming an unknown row, or an option workspace views can't use",
    ),
    403: errorResponse(
      "No workspace access, missing view:create permission, or the project's Views feature is off",
    ),
    404: errorResponse("The project is not in the workspace"),
  },
});

const listBuiltInViewsRoute = createRoute({
  method: "get",
  operationId: "listBuiltInViews",
  path: "/built-in",
  tags: TAGS,
  summary: "List built-in views",
  description:
    "The workspace's fixed task lists: all tasks, assigned to me, created by me and (once task subscriptions exist) subscribed. Each has a base filter that is AND-ed with its filters and can't be changed, and the workspace view defaults. They are not stored and can't be edited or deleted.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { query: builtInViewsQuery },
  responses: {
    200: jsonResponse("The built-in views", builtInViewListSchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access, or missing task:read permission"),
  },
});

const getViewRoute = createRoute({
  method: "get",
  operationId: "getView",
  path: "/{id}",
  tags: TAGS,
  summary: "Get view",
  description:
    "Get one view. Run it with POST /api/task-query: filters.root as filters, filters.archived as archived, and the display options (the layout stays client-side).",
  middleware: [
    viewAccess(),
    requireWorkspacePermission({ view: ["read"] }),
    requireViewsFeatureForView,
  ] as const,
  request: { params: viewParam },
  responses: {
    200: jsonResponse("The view", savedViewSchema),
    403: errorResponse(
      `No workspace access, missing view:read permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
  },
});

const updateViewRoute = createRoute({
  method: "patch",
  operationId: "updateView",
  path: "/{id}",
  tags: TAGS,
  summary: "Update view",
  description:
    "Change a view (its owner with view:update, or view:delete). filters, display and displayProperties merge over the stored values; send filters.root null to clear the filters. Only the owner can make a view private. A locked view refuses every change until unlocked. A change to nothing answers the view and publishes nothing.",
  middleware: [...manageView, requireEntitlement] as const,
  request: { params: viewParam, body: jsonBody(updateViewBody) },
  responses: {
    200: jsonResponse("The updated view", savedViewSchema),
    400: errorResponse(
      "Invalid body, filters the engine can't run, a filter naming an unknown row, or an option workspace views can't use",
    ),
    403: errorResponse(
      `No workspace access, not the owner or an admin, only the owner can make it private, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The view is locked"),
  },
});

const lockViewRoute = createRoute({
  method: "post",
  operationId: "lockView",
  path: "/{id}/lock",
  tags: TAGS,
  summary: "Lock view",
  description:
    "Make a view read-only for everyone, its owner included, until it is unlocked. Needs the owner with view:update, or view:delete. Locking a locked view changes nothing.",
  middleware: [...manageView] as const,
  request: { params: viewParam },
  responses: {
    200: jsonResponse("The locked view", savedViewSchema),
    403: errorResponse(
      `No workspace access, not the owner or an admin, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
  },
});

const unlockViewRoute = createRoute({
  method: "post",
  operationId: "unlockView",
  path: "/{id}/unlock",
  tags: TAGS,
  summary: "Unlock view",
  description:
    "Allow changes to a locked view again. Needs the owner with view:update, or view:delete. Unlocking an unlocked view changes nothing.",
  middleware: [...manageView] as const,
  request: { params: viewParam },
  responses: {
    200: jsonResponse("The unlocked view", savedViewSchema),
    403: errorResponse(
      `No workspace access, not the owner or an admin, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
  },
});

const duplicateViewRoute = createRoute({
  method: "post",
  operationId: "duplicateView",
  path: "/{id}/duplicate",
  tags: TAGS,
  summary: "Duplicate view",
  description:
    'Copy a view into a new, unlocked view owned by the caller, with the same project, access, filters and display. The name defaults to "{name} (copy)".',
  middleware: [
    viewAccess(),
    requireWorkspacePermission({ view: ["create"] }),
    requireViewsFeatureForView,
    requireEntitlement,
  ] as const,
  request: {
    params: viewParam,
    body: {
      required: false,
      content: { "application/json": { schema: duplicateViewBody } },
    },
  },
  responses: {
    200: jsonResponse("The copy", savedViewSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      `No workspace access, missing view:create permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
  },
});

const deleteViewRoute = createRoute({
  method: "delete",
  operationId: "deleteView",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete view",
  description:
    "Delete a view (its owner with view:update, or view:delete), with its favorites and recent visits. Tasks are not affected. A locked view must be unlocked first.",
  middleware: [...manageView] as const,
  request: { params: viewParam },
  responses: {
    200: jsonResponse("The deleted view", deletedViewSchema),
    403: errorResponse(
      `No workspace access, not the owner or an admin, or ${FEATURE_OFF}`,
    ),
    404: errorResponse(NOT_FOUND),
    409: errorResponse("The view is locked"),
  },
});

type ViewVariables = BaseVariables & {
  workspaceId: string;
  projectId: string | null;
};

async function callerOf(c: Context): Promise<ViewCaller> {
  const [canUpdateOwn, canManageAny] = await Promise.all([
    hasWorkspacePermission(c, { view: ["update"] }),
    hasWorkspacePermission(c, { view: ["delete"] }),
  ]);
  return { userId: c.get("userId"), canUpdateOwn, canManageAny };
}

// Literal paths (/, /built-in) are registered before the {id} routes.
const view = apiRouter<ViewVariables>()
  .openapi(listViewsRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await listViews({
        workspaceId: c.get("workspaceId"),
        projectId: c.get("projectId"),
        mine: query.mine === "true",
        search: query.search || undefined,
        caller: await callerOf(c),
      }),
      200,
    );
  })
  .openapi(createViewRoute, async (c) => {
    const {
      workspaceId: _workspaceId,
      projectId: _projectId,
      ...input
    } = c.req.valid("json");
    return c.json(
      await createView({
        input,
        workspaceId: c.get("workspaceId"),
        projectId: c.get("projectId"),
        caller: await callerOf(c),
      }),
      200,
    );
  })
  .openapi(listBuiltInViewsRoute, async (c) => c.json(listBuiltInViews(), 200))
  .openapi(getViewRoute, async (c) =>
    c.json(
      await getViewResponse(c.req.valid("param").id, await callerOf(c)),
      200,
    ),
  )
  .openapi(updateViewRoute, async (c) =>
    c.json(
      await updateView({
        viewId: c.req.valid("param").id,
        input: c.req.valid("json"),
        caller: await callerOf(c),
      }),
      200,
    ),
  )
  .openapi(lockViewRoute, async (c) =>
    c.json(
      await setViewLock({
        viewId: c.req.valid("param").id,
        locked: true,
        caller: await callerOf(c),
      }),
      200,
    ),
  )
  .openapi(unlockViewRoute, async (c) =>
    c.json(
      await setViewLock({
        viewId: c.req.valid("param").id,
        locked: false,
        caller: await callerOf(c),
      }),
      200,
    ),
  )
  .openapi(duplicateViewRoute, async (c) =>
    c.json(
      await duplicateView({
        viewId: c.req.valid("param").id,
        name: c.req.valid("json").name,
        caller: await callerOf(c),
      }),
      200,
    ),
  )
  .openapi(deleteViewRoute, async (c) =>
    c.json(
      await deleteView({
        viewId: c.req.valid("param").id,
        caller: await callerOf(c),
      }),
      200,
    ),
  );

export default view;
