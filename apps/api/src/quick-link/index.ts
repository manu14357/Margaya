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
import createQuickLink from "./controllers/create-quick-link";
import deleteQuickLink from "./controllers/delete-quick-link";
import listQuickLinks from "./controllers/list-quick-links";
import updateQuickLink from "./controllers/update-quick-link";
import {
  quickLinkListSchema,
  quickLinkRemovalSchema,
  quickLinkSchema,
} from "./response";
import {
  createQuickLinkBody,
  QUICK_LINK_BODY_BYTES,
  quickLinkParam,
  updateQuickLinkBody,
  workspaceIdQuery,
} from "./schema";

// Quick links are personal: every query is scoped to the caller's own rows,
// and another user's link answers 404, never 403. The server never fetches
// the URLs.

const TAGS = ["Quick links"];
const readWorkspace = requireWorkspacePermission({ workspace: ["read"] });

function jsonBody<T>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

const listQuickLinksRoute = createRoute({
  method: "get",
  operationId: "listQuickLinks",
  path: "/",
  tags: TAGS,
  summary: "List quick links",
  description:
    "The caller's quick links in a workspace, newest first (at most 50).",
  middleware: [workspaceAccess.fromQuery(), readWorkspace] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The caller's quick links", quickLinkListSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
  },
});

const createQuickLinkRoute = createRoute({
  method: "post",
  operationId: "createQuickLink",
  path: "/",
  tags: TAGS,
  summary: "Add quick link",
  description:
    "Save a link for the caller. The URL is normalized first (https:// is added without a scheme), so the same page can't be saved twice. At most 50 per user and workspace.",
  middleware: [
    boundedRequestBody(QUICK_LINK_BODY_BYTES),
    workspaceAccess.fromBody(),
    readWorkspace,
  ] as const,
  request: { body: jsonBody(createQuickLinkBody) },
  responses: {
    200: jsonResponse("The saved link", quickLinkSchema),
    400: errorResponse("Invalid body, or an invalid or unsafe URL"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    409: errorResponse("The caller already saved this link"),
    413: errorResponse("The body is larger than 8 KB"),
    422: errorResponse("The caller already has 50 quick links here"),
  },
});

const updateQuickLinkRoute = createRoute({
  method: "patch",
  operationId: "updateQuickLink",
  path: "/{id}",
  tags: TAGS,
  summary: "Update quick link",
  description:
    "Change a quick link's URL and/or title; send at least one. A blank or null title clears it. Saving the same values changes nothing.",
  middleware: [
    boundedRequestBody(QUICK_LINK_BODY_BYTES),
    workspaceAccess.fromQuery(),
    readWorkspace,
  ] as const,
  request: {
    params: quickLinkParam,
    query: workspaceIdQuery,
    body: jsonBody(updateQuickLinkBody),
  },
  responses: {
    200: jsonResponse("The link after the change", quickLinkSchema),
    400: errorResponse(
      "Invalid body, unknown fields, nothing to change, or an invalid or unsafe URL",
    ),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    404: errorResponse("No quick link with this id belongs to the caller here"),
    409: errorResponse("Another of the caller's quick links has this URL"),
    413: errorResponse("The body is larger than 8 KB"),
  },
});

const deleteQuickLinkRoute = createRoute({
  method: "delete",
  operationId: "deleteQuickLink",
  path: "/{id}",
  tags: TAGS,
  summary: "Remove quick link",
  description: "Remove one of the caller's quick links.",
  middleware: [workspaceAccess.fromQuery(), readWorkspace] as const,
  request: { params: quickLinkParam, query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The link was removed", quickLinkRemovalSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    404: errorResponse("No quick link with this id belongs to the caller here"),
  },
});

const quickLink = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listQuickLinksRoute, async (c) =>
    c.json(await listQuickLinks(c.get("userId"), c.get("workspaceId")), 200),
  )
  .openapi(createQuickLinkRoute, async (c) => {
    const { url, title } = c.req.valid("json");
    return c.json(
      await createQuickLink({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        url,
        title,
      }),
      200,
    );
  })
  .openapi(updateQuickLinkRoute, async (c) => {
    const { url, title } = c.req.valid("json");
    return c.json(
      await updateQuickLink({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        id: c.req.valid("param").id,
        url,
        title,
      }),
      200,
    );
  })
  .openapi(deleteQuickLinkRoute, async (c) =>
    c.json(
      await deleteQuickLink(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("param").id,
      ),
      200,
    ),
  );

export default quickLink;
