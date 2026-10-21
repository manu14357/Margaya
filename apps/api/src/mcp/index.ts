import { randomUUID } from "node:crypto";
import { McpServer as LegacyMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  isJsonContentType,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth } from "../auth";
import { apiRouter, createRoute, jsonResponse } from "../openapi";
import { verifyApiKey } from "../utils/verify-api-key";
import {
  beginMcpAuthorization,
  decideMcpAuthorizationRequest,
  getMcpAuthorizationRequest,
  registerMcpClient,
} from "./controllers/oauth-consent";
import {
  authorizationServerMetadata,
  isMargayaResource,
  protectedResourceMetadata,
  publicApiOrigin,
} from "./metadata";
import { createModernMcpHandler } from "./modern";
import { exchangeCode } from "./oauth";
import { oauthRequestBounds } from "./request-bounds";
import {
  authorizationDecisionResponseSchema,
  authorizationDecisionSchema,
  authorizationQuerySchema,
  authorizationRequestParamSchema,
  authorizationRequestResponseSchema,
  clientRegistrationResponseSchema,
  clientRegistrationSchema,
  oauthErrorSchema,
} from "./schemas";
import { registerMcpTools, toMcpToolRegistrar } from "./tools";

const publicApiUrl = publicApiOrigin();
const internalApiUrl = (
  process.env.MARGAYA_INTERNAL_API_URL || "http://127.0.0.1:1337"
)
  .replace(/\/api\/?$/, "")
  .replace(/\/+$/, "");

type McpSession = {
  transport: WebStandardStreamableHTTPServerTransport;
  userId: string;
  // The credential the session's tools call the API with; another credential
  // of the same user (say, a narrower API key) must not borrow it.
  token: string;
};

const sessions = new Map<string, McpSession>();

function createMcpServerForUser(token: string): LegacyMcpServer {
  const server = new LegacyMcpServer({
    name: "margaya-mcp",
    version: "1.0.0",
  });
  registerMcpTools(toMcpToolRegistrar(server), internalApiUrl, token);
  return server;
}

export type McpCredential = {
  userId: string;
  token: string;
  apiKeyId?: string;
};

/**
 * Resolves the caller the way the REST API does: an API key (as
 * `Authorization: Bearer <key>` or `x-api-key`) or a bearer session token
 * (OAuth access tokens are sessions). The tools call the REST API with the
 * same credential, so an API key keeps exactly its own permissions there.
 */
export async function authenticateMcpRequest(
  req: Request,
): Promise<McpCredential | null> {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const apiKeyHeader = req.headers.get("x-api-key")?.trim();
  // A malformed Bearer header is refused, as on the REST API.
  if (authHeader && /^Bearer(\s|$)/i.test(authHeader) && !bearer) return null;

  const token = bearer ?? apiKeyHeader;
  if (!token) return null;

  const apiKey = await verifyApiKey(token);
  if (apiKey?.valid && apiKey.key.userId) {
    return { userId: apiKey.key.userId, token, apiKeyId: apiKey.key.id };
  }
  if (!bearer) return null;

  const headers = new Headers();
  headers.set("authorization", `Bearer ${bearer}`);
  const session = await auth.api.getSession({ headers });

  if (!session?.user?.id) return null;
  return { userId: session.user.id, token: bearer };
}

const mcp = apiRouter();
for (const path of [
  "/mcp/register",
  "/mcp/authorize",
  "/mcp/authorize/request/*",
  "/mcp/token",
]) {
  mcp.use(path, oauthRequestBounds);
}

const jsonError = (description: string) =>
  jsonResponse(description, oauthErrorSchema);

// OAuth clients parse validation failures, so these routes answer with the
// RFC 6749 / RFC 7591 JSON error shape instead of the router's text default.
type ValidationResult = { success: boolean; error?: { issues: unknown[] } };

const oauthValidationHook =
  (error: "invalid_request" | "invalid_client_metadata") =>
  (result: ValidationResult): undefined => {
    if (result.success) return;
    const issue = result.error?.issues[0] as
      | { path?: PropertyKey[]; message?: string }
      | undefined;
    const field = issue?.path?.map(String).join(".");
    throw new HTTPException(400, {
      res: Response.json(
        {
          error: field?.startsWith("redirect_uri")
            ? "invalid_redirect_uri"
            : error,
          error_description: issue
            ? `${field || "request"}: ${issue.message}`
            : "Invalid request",
        },
        { status: 400 },
      ),
    });
  };

const registerRoute = createRoute({
  method: "post",
  operationId: "registerMcpOAuthClient",
  path: "/mcp/register",
  tags: ["MCP"],
  summary: "Register MCP OAuth client",
  description:
    "Dynamically register a public OAuth client for the MCP endpoint. Public clients hold no secret, so authorization is protected by PKCE and an explicit consent step.",
  security: [],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: clientRegistrationSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "Registered OAuth client",
      clientRegistrationResponseSchema,
    ),
    400: jsonError("Invalid client metadata"),
  },
});

const authorizeRoute = createRoute({
  method: "get",
  operationId: "authorizeMcpOAuthClient",
  path: "/mcp/authorize",
  tags: ["MCP"],
  summary: "Start MCP authorization",
  description:
    "Begin an MCP OAuth authorization. Redirects the browser to the Margaya consent page, which then approves or denies the request.",
  security: [],
  request: { query: authorizationQuerySchema },
  responses: {
    302: { description: "Redirect to the Margaya consent page" },
    400: jsonError("Invalid authorization request"),
  },
});

const getAuthorizationRequestRoute = createRoute({
  method: "get",
  operationId: "getMcpAuthorizationRequest",
  path: "/mcp/authorize/request/{requestId}",
  tags: ["MCP"],
  summary: "Get consent request",
  description:
    "Get the client name and redirect URI for a pending consent request, so the consent page can show who is asking.",
  security: [],
  request: { params: authorizationRequestParamSchema },
  responses: {
    200: jsonResponse(
      "Authorization request details",
      authorizationRequestResponseSchema,
    ),
    400: jsonError("Invalid OAuth client"),
    404: jsonError("Unknown or expired authorization request"),
  },
});

const decideAuthorizationRequestRoute = createRoute({
  method: "post",
  operationId: "decideMcpAuthorizationRequest",
  path: "/mcp/authorize/request/{requestId}",
  tags: ["MCP"],
  summary: "Decide consent request",
  description:
    "Approve or deny a pending consent request and get the URL to send the browser back to.",
  request: {
    params: authorizationRequestParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: authorizationDecisionSchema } },
    },
  },
  responses: {
    200: jsonResponse(
      "OAuth client redirect",
      authorizationDecisionResponseSchema,
    ),
    400: jsonError("Invalid request or OAuth client"),
    401: jsonError("Authentication required"),
    403: jsonError("Untrusted request origin"),
    404: jsonError("Unknown or expired authorization request"),
  },
});

mcp
  .openapi(
    registerRoute,
    async (c) => c.json(await registerMcpClient(c.req.valid("json")), 200),
    oauthValidationHook("invalid_client_metadata"),
  )
  .openapi(
    authorizeRoute,
    async (c) => c.redirect(await beginMcpAuthorization(c.req.valid("query"))),
    oauthValidationHook("invalid_request"),
  )
  .openapi(
    getAuthorizationRequestRoute,
    async (c) =>
      c.json(
        await getMcpAuthorizationRequest(c.req.valid("param").requestId),
        200,
      ),
    oauthValidationHook("invalid_request"),
  )
  .openapi(
    decideAuthorizationRequestRoute,
    async (c) => {
      const redirect = await decideMcpAuthorizationRequest({
        requestId: c.req.valid("param").requestId,
        decision: c.req.valid("json"),
        headers: c.req.raw.headers,
        origin: c.req.header("origin"),
      });
      return c.json({ redirect }, 200);
    },
    oauthValidationHook("invalid_request"),
  );

mcp.all("/mcp", async (c) => {
  const authResult = await authenticateMcpRequest(c.req.raw);
  if (!authResult) {
    const prmUrl = `${publicApiUrl}/api/.well-known/oauth-protected-resource/api/mcp`;
    c.header("WWW-Authenticate", `Bearer resource_metadata="${prmUrl}"`);
    return c.json(
      {
        error: "invalid_token",
        error_description: "Missing or invalid token",
      },
      401,
    );
  }

  const sessionId = c.req.header("mcp-session-id");

  if (sessionId) {
    const existing = sessions.get(sessionId);
    // A mismatched owner is reported as missing rather than forbidden so the
    // response cannot confirm that someone else's session id is valid.
    if (
      existing &&
      existing.userId === authResult.userId &&
      existing.token === authResult.token
    ) {
      return existing.transport.handleRequest(c.req.raw);
    }
    return c.json({ error: "Session not found" }, 404);
  }

  if (c.req.method !== "POST") {
    return c.json({ error: "Method not allowed" }, 405);
  }

  if (!isJsonContentType(c.req.header("content-type"))) {
    return c.json({ error: "Unsupported Media Type" }, 415);
  }

  if (!(await isLegacyRequest(c.req.raw.clone()))) {
    const modern = createModernMcpHandler(authResult.token, internalApiUrl);
    return modern.fetch(c.req.raw);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
    }
  };

  const server = createMcpServerForUser(authResult.token);
  await server.connect(transport);
  const response = await transport.handleRequest(c.req.raw);

  if (transport.sessionId) {
    sessions.set(transport.sessionId, {
      transport,
      userId: authResult.userId,
      token: authResult.token,
    });
  }

  return response;
});

mcp.post("/mcp/token", async (c) => {
  const contentType = c.req.header("content-type") || "";
  let params: Record<string, unknown>;

  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      params = Object.fromEntries(new URLSearchParams(await c.req.text()));
    } else {
      const input: unknown = await c.req.json();
      if (!input || typeof input !== "object" || Array.isArray(input))
        return c.json({ error: "invalid_request" }, 400);
      params = input as Record<string, unknown>;
    }
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  const { grant_type, code, client_id, code_verifier, redirect_uri, resource } =
    params;

  if (grant_type !== "authorization_code") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }
  if (
    typeof code !== "string" ||
    !code ||
    code.length > 128 ||
    typeof client_id !== "string" ||
    !client_id ||
    client_id.length > 128 ||
    typeof code_verifier !== "string" ||
    !code_verifier ||
    code_verifier.length > 128 ||
    typeof redirect_uri !== "string" ||
    !redirect_uri ||
    redirect_uri.length > 2048
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }

  // RFC 8707: a named resource must be one of Margaya's.
  if (
    resource !== undefined &&
    (typeof resource !== "string" ||
      resource.length > 2048 ||
      !isMargayaResource(resource))
  ) {
    return c.json({ error: "invalid_target" }, 400);
  }

  const result = await exchangeCode(
    code,
    client_id,
    code_verifier,
    redirect_uri,
    resource,
  );
  if (!result) {
    return c.json({ error: "invalid_grant" }, 400);
  }

  return c.json({
    access_token: result.accessToken,
    token_type: "bearer",
    expires_in: result.expiresIn,
  });
});

for (const resource of ["mcp", "a2a"] as const) {
  mcp.get(`/.well-known/oauth-protected-resource/api/${resource}`, (c) =>
    c.json(protectedResourceMetadata(publicApiUrl, resource)),
  );
}

mcp.get("/.well-known/oauth-authorization-server/api", (c) =>
  c.json(authorizationServerMetadata(publicApiUrl)),
);

export default mcp;

export function mcpWellKnownRoutes(baseUrl: string) {
  const wellKnown = new Hono();

  for (const resource of ["mcp", "a2a"] as const) {
    wellKnown.get(
      `/.well-known/oauth-protected-resource/api/${resource}`,
      (c) => c.json(protectedResourceMetadata(baseUrl, resource)),
    );
  }

  wellKnown.get("/.well-known/oauth-authorization-server/api", (c) =>
    c.json(authorizationServerMetadata(baseUrl)),
  );

  return wellKnown;
}
