import type { Context } from "hono";
import { requireAiUse } from "../ai/access";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  aiConnectorListSchema,
  aiConnectorSchema,
  connectorTestSchema,
  deletedConnectorSchema,
} from "./response";
import {
  connectorIdParam,
  connectorWorkspaceBody,
  connectorWorkspaceQuery,
  createConnectorBody,
  updateConnectorBody,
} from "./schema";
import {
  createConnector,
  deleteConnector,
  listConnectors,
  testConnector,
  updateConnector,
} from "./store";
// Side effect: approved connector calls run through ai-agent/changes.
import "./agent-tools";

// Outbound MCP connectors (report: AI gaps §8): outside MCP servers whose
// tools agents with web access may call. Shared connectors need ai:manage;
// anyone with ai:use may add personal ones, used only in runs on their
// behalf.

const TAGS = ["AI connectors"];
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
const forbidden = errorResponse(
  "No workspace access, no ai:use, or a shared connector without ai:manage",
);

const listRoute = createRoute({
  method: "get",
  operationId: "listAiConnectors",
  path: "/",
  tags: TAGS,
  summary: "List MCP connectors",
  description:
    "The workspace's shared connectors and your personal ones. URLs and secret hints only for the people who may change each connector. Needs ai:use.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { query: connectorWorkspaceQuery },
  responses: {
    200: jsonResponse("The connectors", aiConnectorListSchema),
    403: forbidden,
  },
});

const createConnectorRoute = createRoute({
  method: "post",
  operationId: "createAiConnector",
  path: "/",
  tags: TAGS,
  summary: "Add an MCP connector",
  description:
    "Add an outside MCP server (Streamable HTTP). The URL must resolve to a public address. A header secret is stored sealed and never returned. Shared connectors need ai:manage. At most 50 per workspace. Recorded in the audit log.",
  middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
  request: { body: json(createConnectorBody) },
  responses: {
    200: jsonResponse("The connector", aiConnectorSchema),
    400: errorResponse("Invalid body, or the URL isn't a public address"),
    403: forbidden,
    409: errorResponse("The workspace already has 50 connectors"),
  },
});

const updateConnectorRoute = createRoute({
  method: "patch",
  operationId: "updateAiConnector",
  path: "/{connectorId}",
  tags: TAGS,
  summary: "Update an MCP connector",
  description:
    "Change a connector's name, URL, auth or secret, or turn it off. Its owner, or ai:manage for shared ones. Recorded in the audit log (field names only).",
  middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
  request: { params: connectorIdParam, body: json(updateConnectorBody) },
  responses: {
    200: jsonResponse("The connector", aiConnectorSchema),
    400: errorResponse("Invalid body, or the URL isn't a public address"),
    403: forbidden,
    404: errorResponse("Connector not found"),
  },
});

const deleteConnectorRoute = createRoute({
  method: "delete",
  operationId: "deleteAiConnector",
  path: "/{connectorId}",
  tags: TAGS,
  summary: "Delete an MCP connector",
  description:
    "Remove a connector and its sealed secret. Its owner, or ai:manage for shared ones.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { params: connectorIdParam, query: connectorWorkspaceQuery },
  responses: {
    200: jsonResponse("The deleted connector", deletedConnectorSchema),
    403: forbidden,
    404: errorResponse("Connector not found"),
  },
});

const testConnectorRoute = createRoute({
  method: "post",
  operationId: "testAiConnector",
  path: "/{connectorId}/test",
  tags: TAGS,
  summary: "Test an MCP connector",
  description:
    "Connect to the server (initialize, then tools/list) and report its tools, or why it failed. Its owner, or ai:manage for shared ones.",
  middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
  request: { params: connectorIdParam, body: json(connectorWorkspaceBody) },
  responses: {
    200: jsonResponse("The outcome", connectorTestSchema),
    403: forbidden,
    404: errorResponse("Connector not found"),
  },
});

async function actorOf(c: Context) {
  return {
    workspaceId: c.get("workspaceId") as string,
    userId: c.get("userId") as string,
    canManage: (await workspacePermissionChecker(c))({ ai: ["manage"] }),
  };
}

const aiConnectors = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listRoute, async (c) =>
    c.json(await listConnectors(await actorOf(c)), 200),
  )
  .openapi(createConnectorRoute, async (c) => {
    const { workspaceId: _ignored, ...input } = c.req.valid("json");
    return c.json(await createConnector(await actorOf(c), input), 200);
  })
  .openapi(updateConnectorRoute, async (c) => {
    const { workspaceId: _ignored, ...patch } = c.req.valid("json");
    return c.json(
      await updateConnector(
        await actorOf(c),
        c.req.valid("param").connectorId,
        patch,
      ),
      200,
    );
  })
  .openapi(deleteConnectorRoute, async (c) =>
    c.json(
      await deleteConnector(await actorOf(c), c.req.valid("param").connectorId),
      200,
    ),
  )
  .openapi(testConnectorRoute, async (c) =>
    c.json(
      await testConnector(await actorOf(c), c.req.valid("param").connectorId),
      200,
    ),
  );

export default aiConnectors;
