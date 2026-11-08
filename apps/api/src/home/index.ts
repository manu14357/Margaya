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
import {
  getHomePreferences,
  updateHomePreferences,
} from "./controllers/home-preferences";
import { homePreferencesSchema } from "./response";
import {
  HOME_PREFERENCES_BODY_BYTES,
  updateHomePreferencesBody,
  workspaceIdQuery,
} from "./schema";

// Home settings are personal: the caller only ever reads and writes their
// own row.

const TAGS = ["Home"];
const readWorkspace = requireWorkspacePermission({ workspace: ["read"] });

const getHomePreferencesRoute = createRoute({
  method: "get",
  operationId: "getHomePreferences",
  path: "/preferences",
  tags: TAGS,
  summary: "Get Home preferences",
  description:
    "The caller's Home widget order and visibility in a workspace. Without saved settings, every widget is shown in the default order and updatedAt is null.",
  middleware: [workspaceAccess.fromQuery(), readWorkspace] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The caller's Home widgets", homePreferencesSchema),
    400: errorResponse("Workspace ID could not be determined"),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
  },
});

const updateHomePreferencesRoute = createRoute({
  method: "put",
  operationId: "updateHomePreferences",
  path: "/preferences",
  tags: TAGS,
  summary: "Save Home preferences",
  description:
    "Save the caller's Home widget order and visibility, and which saved reports are pinned. The list must name every widget exactly once; turning every widget off is allowed.",
  middleware: [
    boundedRequestBody(HOME_PREFERENCES_BODY_BYTES),
    workspaceAccess.fromBody(),
    readWorkspace,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: updateHomePreferencesBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved Home widgets", homePreferencesSchema),
    400: errorResponse(
      "Invalid body, or a list that does not name every widget exactly once",
    ),
    403: errorResponse(
      "No workspace access, or missing workspace:read permission",
    ),
    413: errorResponse("The body is larger than 4 KB"),
  },
});

const home = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getHomePreferencesRoute, async (c) =>
    c.json(
      await getHomePreferences(c.get("userId"), c.get("workspaceId")),
      200,
    ),
  )
  .openapi(updateHomePreferencesRoute, async (c) =>
    c.json(
      await updateHomePreferences(
        c.get("userId"),
        c.get("workspaceId"),
        c.req.valid("json").widgets,
      ),
      200,
    ),
  );

export default home;
