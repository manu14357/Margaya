import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireUserSession } from "../utils/require-user-session";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  createSlackConnection,
  deleteSlackConnection,
  getSlackAppState,
  testSlackConnection,
  updateSlackConnection,
} from "./connection";
import { confirmLink, deleteOwnLink, listLinks, previewLink } from "./links";
import {
  deletedSchema,
  slackAppStateSchema,
  slackAppTestSchema,
  slackLinkPreviewSchema,
  slackLinkSchema,
} from "./response";
import {
  createSlackAppBody,
  linkIdParam,
  linkTokenBody,
  updateSlackAppBody,
  workspaceIdParam,
} from "./schema";

// Two-way Slack (#10): the workspace's Slack app settings, and each user's
// own account links. Inbound Slack traffic does not come through here:
// Socket Mode is outbound (socket.ts) and HTTP mode has its own signed
// endpoint (http.ts, POST /api/slack/events/{workspaceId}).

const TAGS = ["Slack app"];

const manageAccess = [
  workspaceAccess.fromParam("workspaceId"),
  requireWorkspacePermission({ workspace: ["manage_settings"] }),
];

const NO_MANAGE = "No workspace access, or missing workspace:manage_settings";

const getSlackAppRoute = createRoute({
  method: "get",
  operationId: "getSlackApp",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "Get Slack app settings",
  description:
    "The workspace's Slack app connection (credentials masked), or null, plus what setting one up needs: the HTTP events URL, the unfurl domain and app manifests for both modes. Needs workspace:manage_settings.",
  middleware: manageAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Connection and setup details", slackAppStateSchema),
    403: errorResponse(NO_MANAGE),
  },
});

const createSlackAppRoute = createRoute({
  method: "post",
  operationId: "connectSlackApp",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "Connect Slack app",
  description:
    "Connect (or replace) the workspace's Slack app. Socket Mode, the default, needs the bot token and an app-level token; HTTP mode needs the bot token and the signing secret. Tokens are stored encrypted and never returned. Credentials are checked for shape only; call the test route to check them with Slack.",
  middleware: manageAccess,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createSlackAppBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored connection", slackAppStateSchema),
    400: errorResponse(
      "A malformed token, a missing credential for the mode, or a default project outside the workspace",
    ),
    403: errorResponse(NO_MANAGE),
  },
});

const updateSlackAppRoute = createRoute({
  method: "patch",
  operationId: "updateSlackApp",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "Update Slack app",
  description:
    "Change the mode, credentials, default project, task key previews or the on/off switch. Omitted fields, credentials included, keep their stored value.",
  middleware: manageAccess,
  request: {
    params: workspaceIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateSlackAppBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated connection", slackAppStateSchema),
    400: errorResponse(
      "A malformed token, a missing credential for the mode, or a default project outside the workspace",
    ),
    403: errorResponse(NO_MANAGE),
    404: errorResponse("The workspace has no Slack app connected"),
  },
});

const deleteSlackAppRoute = createRoute({
  method: "delete",
  operationId: "disconnectSlackApp",
  path: "/workspace/{workspaceId}",
  tags: TAGS,
  summary: "Disconnect Slack app",
  description:
    "Remove the workspace's Slack app and its stored credentials. Account links are kept, so reconnecting the same Slack workspace needs no relinking.",
  middleware: manageAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("The connection was removed", deletedSchema),
    403: errorResponse(NO_MANAGE),
    404: errorResponse("The workspace has no Slack app connected"),
  },
});

const testSlackAppRoute = createRoute({
  method: "post",
  operationId: "testSlackApp",
  path: "/workspace/{workspaceId}/test",
  tags: TAGS,
  summary: "Test Slack app connection",
  description:
    "Check the stored credentials with Slack: the bot token (auth.test, which also records the Slack workspace name), and the app-level token in Socket Mode. Failures answer 200 with ok false and Slack's error code.",
  middleware: manageAccess,
  request: { params: workspaceIdParam },
  responses: {
    200: jsonResponse("Each check's result", slackAppTestSchema),
    403: errorResponse(NO_MANAGE),
    404: errorResponse("The workspace has no Slack app connected"),
  },
});

const listLinksRoute = createRoute({
  method: "get",
  operationId: "listSlackLinks",
  path: "/links",
  tags: TAGS,
  summary: "List my Slack links",
  description:
    "The caller's linked Slack accounts, one per workspace and Slack user. Slack actions by a linked Slack user run as the caller.",
  request: {},
  responses: {
    200: jsonResponse("The caller's links", slackLinkSchema.array()),
  },
});

const previewLinkRoute = createRoute({
  method: "post",
  operationId: "previewSlackLink",
  path: "/links/preview",
  tags: TAGS,
  summary: "Preview a Slack link",
  description:
    "Read a link prompt's token before confirming: which workspace and Slack account it names. Needs a signed-in session (not an API key) and membership of the workspace.",
  middleware: [requireUserSession] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: linkTokenBody } },
    },
  },
  responses: {
    200: jsonResponse("What the link would connect", slackLinkPreviewSchema),
    400: errorResponse("The token expired or is invalid"),
    403: errorResponse("An API key, or not a member of the workspace"),
  },
});

const confirmLinkRoute = createRoute({
  method: "post",
  operationId: "confirmSlackLink",
  path: "/links",
  tags: TAGS,
  summary: "Link a Slack account",
  description:
    "Link the Slack account named by a link prompt's token to the caller. From then on that Slack user's commands, shortcuts and buttons run as the caller, with the caller's permissions. A Slack user linked to someone else moves to the caller. Needs a signed-in session (not an API key).",
  middleware: [requireUserSession] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: linkTokenBody } },
    },
  },
  responses: {
    200: jsonResponse("The link", slackLinkSchema),
    400: errorResponse("The token expired or is invalid"),
    403: errorResponse("An API key, or not a member of the workspace"),
  },
});

const deleteLinkRoute = createRoute({
  method: "delete",
  operationId: "deleteSlackLink",
  path: "/links/{id}",
  tags: TAGS,
  summary: "Unlink a Slack account",
  description: "Remove one of the caller's own Slack links.",
  request: { params: linkIdParam },
  responses: {
    200: jsonResponse("The link was removed", deletedSchema),
    404: errorResponse("No such link of the caller's"),
  },
});

const slackApp = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listLinksRoute, async (c) => {
    return c.json(await listLinks(c.get("userId")), 200);
  })
  .openapi(previewLinkRoute, async (c) => {
    const { token } = c.req.valid("json");
    return c.json(await previewLink(token, c.get("userId")), 200);
  })
  .openapi(confirmLinkRoute, async (c) => {
    const { token } = c.req.valid("json");
    return c.json(await confirmLink(token, c.get("userId")), 200);
  })
  .openapi(deleteLinkRoute, async (c) => {
    const { id } = c.req.valid("param");
    await deleteOwnLink(id, c.get("userId"));
    return c.json({ success: true }, 200);
  })
  .openapi(getSlackAppRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await getSlackAppState(workspaceId), 200);
  })
  .openapi(createSlackAppRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(
      await createSlackConnection(workspaceId, c.get("userId"), body),
      200,
    );
  })
  .openapi(updateSlackAppRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const body = c.req.valid("json");
    return c.json(await updateSlackConnection(workspaceId, body), 200);
  })
  .openapi(deleteSlackAppRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    await deleteSlackConnection(workspaceId);
    return c.json({ success: true }, 200);
  })
  .openapi(testSlackAppRoute, async (c) => {
    const { workspaceId } = c.req.valid("param");
    return c.json(await testSlackConnection(workspaceId), 200);
  });

export default slackApp;
