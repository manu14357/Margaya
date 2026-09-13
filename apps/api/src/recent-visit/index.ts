import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import listRecentVisits from "./controllers/list-recent-visits";
import recordRecentVisit from "./controllers/record-recent-visit";
import { recentVisitListSchema, recentVisitSchema } from "./response";
import { listRecentVisitsQuery, recordRecentVisitBody } from "./schema";

// Visits are recorded explicitly by the web; API and MCP reads never count.
// Every query is scoped to the caller's own rows.

const recordRecentVisitRoute = createRoute({
  method: "post",
  operationId: "recordRecentVisit",
  path: "/",
  tags: ["Recent visits"],
  summary: "Record visit",
  description:
    "Record that the caller visited an entity. Revisiting moves it to the top; only the 20 most recent visits per workspace are kept.",
  middleware: [
    workspaceAccess.fromBody(),
    requireWorkspacePermission({ project: ["read"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: recordRecentVisitBody } },
    },
  },
  responses: {
    200: jsonResponse("The recorded visit", recentVisitSchema),
    400: errorResponse("Invalid body, or an unsupported entity type"),
    403: errorResponse(
      "No workspace access, or missing project:read permission",
    ),
    404: errorResponse("The entity does not exist in this workspace"),
    409: errorResponse("The entity is archived or its feature is turned off"),
  },
});

const listRecentVisitsRoute = createRoute({
  method: "get",
  operationId: "listRecentVisits",
  path: "/",
  tags: ["Recent visits"],
  summary: "List recent visits",
  description:
    "List the caller's most recent visits in a workspace, newest first. Visits of archived or feature-disabled entities are hidden; visits of deleted entities are removed.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: listRecentVisitsQuery },
  responses: {
    200: jsonResponse("The caller's recent visits", recentVisitListSchema),
    400: errorResponse(
      "Invalid query, or workspace ID could not be determined",
    ),
    403: errorResponse("No access to the workspace"),
  },
});

const recentVisit = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(recordRecentVisitRoute, async (c) => {
    const { entityType, entityId } = c.req.valid("json");
    return c.json(
      await recordRecentVisit({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        entityType,
        entityId,
      }),
      200,
    );
  })
  .openapi(listRecentVisitsRoute, async (c) => {
    const { entityType, limit } = c.req.valid("query");
    return c.json(
      await listRecentVisits(c.get("userId"), c.get("workspaceId"), {
        entityType,
        limit,
      }),
      200,
    );
  });

export default recentVisit;
