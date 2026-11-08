import type { Context } from "hono";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { isWorkspaceGuest } from "../project/visibility";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import globalSearch from "./controllers/global-search";
import { searchResponseSchema } from "./response";
import { searchQuery } from "./schema";

const globalSearchRoute = createRoute({
  method: "get",
  operationId: "globalSearch",
  path: "/",
  tags: ["Search"],
  summary: "Global search",
  description:
    "Search across tasks, projects, workspaces, comments, activities, pages, cycles, modules, saved views and intake requests in one workspace. Pages need page:read and appear only when public or the caller's own, not archived, in projects with Pages on. Cycles, modules and views need cycle:read, module:read and view:read; archived cycles and modules, other people's private views, and projects with the feature off are left out. Intake requests not yet accepted appear with intake:read, or only the caller's own with intake:create alone. Matching is PostgreSQL full-text search: `q` takes web-search syntax (\"quoted phrases\", `or`, `-exclude`), the last word also matches as a prefix, and accents are ignored where the server supports it. A whole-query task key such as `WEB-12` ranks first. Chinese, Japanese and Thai text also matches by substring. Results are ranked by relevance and returned as a single flat list, each entry tagged with its `type`; task, comment and page results carry a highlighted `snippet`. An activity is never matched or described by what it says about a project the caller can't see.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: searchQuery },
  responses: {
    200: jsonResponse("Ranked search results", searchResponseSchema),
    400: errorResponse(
      "Invalid query, or workspace ID could not be determined",
    ),
    403: errorResponse("No access to the workspace"),
  },
});

/** What the caller may find beyond tasks, projects and comments. */
async function searchPermissions(c: Context) {
  const can = await workspacePermissionChecker(c);
  const intakeVisibility: "all" | "own" | "none" = can({ intake: ["read"] })
    ? "all"
    : can({ intake: ["create"] })
      ? "own"
      : "none";
  // Views can be workspace-wide, which is outside what a guest may reach.
  const guest = await isWorkspaceGuest(c.get("userId"), c.get("workspaceId"));
  return {
    canReadPages: can({ page: ["read"] }),
    canReadCycles: can({ cycle: ["read"] }),
    canReadModules: can({ module: ["read"] }),
    canReadViews: can({ view: ["read"] }) && !guest,
    intakeVisibility,
  };
}

const search = apiRouter().openapi(globalSearchRoute, async (c) => {
  const { q, type, workspaceId, projectId, limit, userEmail } =
    c.req.valid("query");

  return c.json(
    await globalSearch({
      query: q,
      userId: c.get("userId"),
      userEmail,
      type,
      workspaceId,
      projectId,
      limit,
      ...(await searchPermissions(c)),
    }),
    200,
  );
});

export default search;
