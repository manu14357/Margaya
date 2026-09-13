import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { getArchiveSummary } from "./controllers/get-archive-summary";
import { listArchived } from "./controllers/list-archived";
import { archivedEntityListSchema, archiveSummarySchema } from "./response";
import {
  archivedTypeParam,
  archiveSummaryQuery,
  listArchivedQuery,
} from "./schema";
import { resolveArchiveScope } from "./scope";

// Read-only: restoring and deleting go through each owner's routes. Archived
// tasks are listed by the task query engine (`archived: "only"`).

const TAGS = ["Archives"];
const middleware = [
  workspaceAccess.fromQuery(),
  requireWorkspacePermission({ project: ["read"] }),
] as const;

const getArchiveSummaryRoute = createRoute({
  method: "get",
  operationId: "getArchiveSummary",
  path: "/summary",
  tags: TAGS,
  summary: "Archive counts",
  description:
    "How many tasks, cycles, modules and projects are archived in the workspace (its projects that are not archived) or in one project, archived or not. A null count means the tab is hidden for the caller: no read permission, the feature is off in every project in scope, or projects inside a project scope.",
  middleware: [...middleware] as const,
  request: { query: archiveSummaryQuery },
  responses: {
    200: jsonResponse("The archive counts", archiveSummarySchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access, or missing project:read"),
    404: errorResponse("Project not found in this workspace"),
  },
});

const listArchivedRoute = createRoute({
  method: "get",
  operationId: "listArchived",
  path: "/{type}",
  tags: TAGS,
  summary: "List archived items",
  description:
    "One page of archived cycles, modules or projects, most recently archived first, then by name. Cycles and modules come only from projects with that feature on and need cycle:read or module:read. Each item says whether the caller may restore or delete it through its owner's routes.",
  middleware: [...middleware] as const,
  request: { params: archivedTypeParam, query: listArchivedQuery },
  responses: {
    200: jsonResponse("A page of archived items", archivedEntityListSchema),
    400: errorResponse(
      "Invalid query, or projects asked for inside a project scope",
    ),
    403: errorResponse(
      "No workspace access, missing the read permission, or the feature is off for this project",
    ),
    404: errorResponse("Project not found in this workspace"),
  },
});

const archive = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getArchiveSummaryRoute, async (c) => {
    const scope = await resolveArchiveScope(c, c.req.valid("query").projectId);
    return c.json(await getArchiveSummary(scope), 200);
  })
  .openapi(listArchivedRoute, async (c) => {
    const { projectId, search, page, limit } = c.req.valid("query");
    const scope = await resolveArchiveScope(c, projectId);
    return c.json(
      await listArchived(scope, c.req.valid("param").type, {
        search,
        page,
        limit,
      }),
      200,
    );
  });

export default archive;
