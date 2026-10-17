import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireUserSession } from "../utils/require-user-session";
import { assertOwnApiKey, createScopedApiKey, listApiKeys } from "./keys";
import { listApiKeyRequests } from "./request-log";
import {
  apiKeyRequestPageSchema,
  apiKeySummarySchema,
  createdApiKeySchema,
} from "./response";
import {
  apiKeyIdParam,
  createScopedApiKeyBody,
  listApiKeyRequestsQuery,
} from "./schema";

// The caller's own API keys: scoped creation, scopes and the request log
// (4.10). Revoking stays on Better Auth's /auth/api-key/delete. Every route
// needs a signed-in session: a key can't manage keys.

const TAGS = ["API keys"];
const SESSION_NOTE = " Needs a signed-in session; API keys are refused.";
const sessionOnly = errorResponse("An API key instead of a user session");

const listRoute = createRoute({
  method: "get",
  operationId: "listApiKeys",
  path: "/",
  tags: TAGS,
  summary: "List your API keys",
  description: `Your API keys, newest first, with each key's scope: its access (full, read or custom), permission areas and projects. The key itself is never returned.${SESSION_NOTE}`,
  middleware: [requireUserSession],
  responses: {
    200: jsonResponse("Your keys", z.array(apiKeySummarySchema)),
    403: sessionOnly,
  },
});

const createRouteDef = createRoute({
  method: "post",
  operationId: "createScopedApiKey",
  path: "/",
  tags: TAGS,
  summary: "Create an API key",
  description: `Create a key, optionally limited: read-only (GET requests and queries only), custom permission areas, and specific projects. A key never exceeds its owner's own role. Scoped keys work on the REST API and MCP only, not on the /auth routes. Existing keys without a scope keep full access.${SESSION_NOTE}`,
  middleware: [requireUserSession],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createScopedApiKeyBody } },
    },
  },
  responses: {
    200: jsonResponse("The new key, shown once", createdApiKeySchema),
    400: errorResponse("Invalid name, expiry, area or project"),
    403: sessionOnly,
  },
});

const requestsRoute = createRoute({
  method: "get",
  operationId: "listApiKeyRequests",
  path: "/{id}/requests",
  tags: TAGS,
  summary: "List an API key's requests",
  description: `Recent REST requests made with one of your keys, newest first: time, method, route template, status and duration. Bodies, query strings and headers are never stored. Rows are kept for API_REQUEST_LOG_RETENTION_DAYS (14 by default). Page with nextCursor.${SESSION_NOTE}`,
  middleware: [requireUserSession],
  request: { params: apiKeyIdParam, query: listApiKeyRequestsQuery },
  responses: {
    200: jsonResponse("A page of requests", apiKeyRequestPageSchema),
    400: errorResponse("Invalid cursor"),
    403: sessionOnly,
    404: errorResponse("Not one of your keys"),
  },
});

const apiKeyRoutes = apiRouter()
  .openapi(listRoute, async (c) =>
    c.json(await listApiKeys(c.get("userId")), 200),
  )
  .openapi(createRouteDef, async (c) =>
    c.json(await createScopedApiKey(c.get("userId"), c.req.valid("json")), 200),
  )
  .openapi(requestsRoute, async (c) => {
    const { id } = c.req.valid("param");
    await assertOwnApiKey(c.get("userId"), id);
    const { cursor, limit } = c.req.valid("query");
    return c.json(
      await listApiKeyRequests({ apiKeyId: id, cursor, limit }),
      200,
    );
  });

export default apiKeyRoutes;
