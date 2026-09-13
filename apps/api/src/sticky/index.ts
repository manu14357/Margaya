import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createSticky from "./controllers/create-sticky";
import deleteSticky from "./controllers/delete-sticky";
import listStickies from "./controllers/list-stickies";
import reorderStickies from "./controllers/reorder-stickies";
import updateSticky from "./controllers/update-sticky";
import {
  stickyPageSchema,
  stickyRemovalSchema,
  stickyReorderResultSchema,
  stickySchema,
} from "./response";
import {
  createStickyBody,
  listStickiesQuery,
  reorderStickiesBody,
  STICKY_BODY_BYTES,
  STICKY_REORDER_BODY_BYTES,
  stickyParam,
  updateStickyBody,
  workspaceIdQuery,
} from "./schema";

// Stickies are personal: every query is scoped to the caller's own rows, and
// another user's sticky answers 404, never 403.

const TAGS = ["Stickies"];
const readWorkspace = requireWorkspacePermission({ workspace: ["read"] });

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const listStickiesRoute = createRoute({
  method: "get",
  operationId: "listStickies",
  path: "/",
  tags: TAGS,
  summary: "List stickies",
  description:
    "One page of the caller's stickies in a workspace, in display order (position, then id). Filter with q to search their text; page with the returned nextCursor.",
  middleware: [workspaceAccess.fromQuery(), readWorkspace] as const,
  request: { query: listStickiesQuery },
  responses: {
    200: jsonResponse("A page of the caller's stickies", stickyPageSchema),
    400: errorResponse("Invalid query or cursor"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
  },
});

const createStickyRoute = createRoute({
  method: "post",
  operationId: "createSticky",
  path: "/",
  tags: TAGS,
  summary: "Create sticky",
  description:
    "Add a sticky on top of the caller's list. At most 500 stickies per user and workspace.",
  middleware: [
    boundedRequestBody(STICKY_BODY_BYTES),
    workspaceAccess.fromBody(),
    readWorkspace,
  ] as const,
  request: { body: jsonBody(createStickyBody) },
  responses: {
    200: jsonResponse("The new sticky", stickySchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    409: errorResponse("The caller already has 500 stickies here"),
    413: errorResponse("The body is larger than 128 KB"),
  },
});

const reorderStickiesRoute = createRoute({
  method: "put",
  operationId: "reorderStickies",
  path: "/reorder",
  tags: TAGS,
  summary: "Reorder stickies",
  description:
    "Set the relative order of some of the caller's stickies. Stickies left out keep their rank; the list is renumbered to 0..n-1.",
  middleware: [
    boundedRequestBody(STICKY_REORDER_BODY_BYTES),
    workspaceAccess.fromQuery(),
    readWorkspace,
  ] as const,
  request: { query: workspaceIdQuery, body: jsonBody(reorderStickiesBody) },
  responses: {
    200: jsonResponse("How many stickies moved", stickyReorderResultSchema),
    400: errorResponse(
      "Invalid body, duplicate ids, or an id that is not one of the caller's stickies",
    ),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    413: errorResponse("The body is larger than 64 KB"),
  },
});

const updateStickyRoute = createRoute({
  method: "patch",
  operationId: "updateSticky",
  path: "/{id}",
  tags: TAGS,
  summary: "Update sticky",
  description:
    "Change a sticky's content and/or color; send at least one. Sending the stored values changes nothing.",
  middleware: [
    boundedRequestBody(STICKY_BODY_BYTES),
    workspaceAccess.fromQuery(),
    readWorkspace,
  ] as const,
  request: {
    params: stickyParam,
    query: workspaceIdQuery,
    body: jsonBody(updateStickyBody),
  },
  responses: {
    200: jsonResponse("The sticky after the change", stickySchema),
    400: errorResponse("Invalid body, unknown fields, or nothing to change"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    404: errorResponse("No sticky with this id belongs to the caller here"),
    413: errorResponse("The body is larger than 128 KB"),
  },
});

const deleteStickyRoute = createRoute({
  method: "delete",
  operationId: "deleteSticky",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete sticky",
  description: "Delete one of the caller's stickies for good.",
  middleware: [workspaceAccess.fromQuery(), readWorkspace] as const,
  request: { params: stickyParam, query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The sticky was deleted", stickyRemovalSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    404: errorResponse("No sticky with this id belongs to the caller here"),
  },
});

const sticky = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listStickiesRoute, async (c) => {
    const { q, limit, cursor } = c.req.valid("query");
    return c.json(
      await listStickies({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        q,
        limit,
        cursor,
      }),
      200,
    );
  })
  .openapi(createStickyRoute, async (c) => {
    const { content, color } = c.req.valid("json");
    return c.json(
      await createSticky({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        content,
        color,
      }),
      200,
    );
  })
  .openapi(reorderStickiesRoute, async (c) =>
    c.json(
      await reorderStickies(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("json").stickyIds,
      ),
      200,
    ),
  )
  .openapi(updateStickyRoute, async (c) => {
    const { content, color } = c.req.valid("json");
    return c.json(
      await updateSticky({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        id: c.req.valid("param").id,
        content,
        color,
      }),
      200,
    );
  })
  .openapi(deleteStickyRoute, async (c) =>
    c.json(
      await deleteSticky(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("param").id,
      ),
      200,
    ),
  );

export default sticky;
