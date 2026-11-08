import { requireInstanceAdmin } from "../instance-admin/middleware";
import { requireRecentAuth } from "../instance-admin/reauth";
import { instanceReauthRequiredSchema } from "../instance-admin/response";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireUserSession } from "../utils/require-user-session";
import {
  createSamlConnection,
  deleteSamlConnection,
  draftSamlConnection,
  listSamlConnections,
  updateSamlConnection,
} from "./controllers/saml-connections";
import {
  createScimConnection,
  deleteScimConnection,
  listScimConnections,
  rotateScimConnectionToken,
} from "./controllers/scim-connections";
import {
  identityConnectionDeletedSchema,
  samlConnectionDraftSchema,
  samlConnectionListSchema,
  samlConnectionSchema,
  scimConnectionListSchema,
  scimConnectionTokenSchema,
} from "./response";
import {
  createSamlConnectionBody,
  createScimConnectionBody,
  identityConnectionParam,
  updateSamlConnectionBody,
} from "./schema";

// Connections to an identity provider, for instance admins only. The SCIM and
// SAML endpoints the provider itself calls are Better Auth's (auth.ts).

const TAGS = ["Instance admin"];
const ADMIN_NOTE =
  " Instance admins only, with a signed-in session: API keys are refused.";
const REAUTH_NOTE =
  " Needs a recent sign-in: a session opened in the last 10 minutes, or a password confirmed through POST /instance-admin/reauth; otherwise 403 with code REAUTH_REQUIRED.";

const forbidden = errorResponse(
  "Not an instance admin, or an API key instead of a user session",
);
const forbiddenOrStale = {
  description:
    "Not an instance admin, an API key instead of a user session, or no recent sign-in (JSON with code REAUTH_REQUIRED)",
  content: {
    "text/plain": { schema: z.string() },
    "application/json": { schema: instanceReauthRequiredSchema },
  },
};
const tooOften = errorResponse(
  "Too many requests; retry after the Retry-After seconds",
);
const notFound = errorResponse("No such connection");
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});

const readAccess = [requireUserSession, requireInstanceAdmin] as const;
const writeAccess = [
  requireUserSession,
  requireInstanceAdmin,
  requireRecentAuth,
] as const;

const listScimRoute = createRoute({
  method: "get",
  operationId: "listScimConnections",
  path: "/scim",
  tags: TAGS,
  summary: "List SCIM connections",
  description: `Each identity provider connected for provisioning, its workspace and how many people it manages. Tokens are never returned here.${ADMIN_NOTE}`,
  middleware: [...readAccess],
  responses: {
    200: jsonResponse("The connections", scimConnectionListSchema),
    403: forbidden,
  },
});

const createScimRoute = createRoute({
  method: "post",
  operationId: "createScimConnection",
  path: "/scim",
  tags: TAGS,
  summary: "Connect an identity provider for provisioning",
  description: `Creates a connection bound to one workspace and returns its bearer token once. Whoever holds it can add people to that workspace, and change or deactivate the accounts it manages, so give it only to the identity provider.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [...writeAccess],
  request: { body: json(createScimConnectionBody) },
  responses: {
    200: jsonResponse(
      "Created; the only response with the token",
      scimConnectionTokenSchema,
    ),
    400: errorResponse("Invalid request"),
    403: forbiddenOrStale,
    404: errorResponse("No such workspace"),
    409: errorResponse("The workspace is scheduled for deletion"),
    429: tooOften,
  },
});

const rotateScimRoute = createRoute({
  method: "post",
  operationId: "rotateScimConnectionToken",
  path: "/scim/{id}/rotate",
  tags: TAGS,
  summary: "Replace a SCIM token",
  description: `Returns a new token once. The old one stops working immediately; the people the connection manages stay linked.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [...writeAccess],
  request: { params: identityConnectionParam },
  responses: {
    200: jsonResponse(
      "Rotated; the only response with the new token",
      scimConnectionTokenSchema,
    ),
    403: forbiddenOrStale,
    404: notFound,
    429: tooOften,
  },
});

const deleteScimRoute = createRoute({
  method: "delete",
  operationId: "deleteScimConnection",
  path: "/scim/{id}",
  tags: TAGS,
  summary: "Remove a SCIM connection",
  description: `The token stops working immediately. The people it added keep their accounts and memberships.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [...writeAccess],
  request: { params: identityConnectionParam },
  responses: {
    200: jsonResponse("Removed", identityConnectionDeletedSchema),
    403: forbiddenOrStale,
    404: notFound,
    429: tooOften,
  },
});

const listSamlRoute = createRoute({
  method: "get",
  operationId: "listSamlConnections",
  path: "/saml",
  tags: TAGS,
  summary: "List SAML connections",
  description: `Each identity provider connected for sign-in, with the addresses to configure on its side.${ADMIN_NOTE}`,
  middleware: [...readAccess],
  responses: {
    200: jsonResponse("The connections", samlConnectionListSchema),
    403: forbidden,
  },
});

const draftSamlRoute = createRoute({
  method: "get",
  operationId: "draftSamlConnection",
  path: "/saml/new",
  tags: TAGS,
  summary: "Get addresses for a new SAML connection",
  description: `An identity provider usually wants these addresses before it gives you its own, so they are available before the connection exists. Creates nothing; send the key back when creating it.${ADMIN_NOTE}`,
  middleware: [...readAccess],
  responses: {
    200: jsonResponse(
      "Addresses for a new connection",
      samlConnectionDraftSchema,
    ),
    403: forbidden,
  },
});

const createSamlRoute = createRoute({
  method: "post",
  operationId: "createSamlConnection",
  path: "/saml",
  tags: TAGS,
  summary: "Connect an identity provider for SAML sign-in",
  description: `Whoever controls this identity provider can sign in anyone on these email domains whose address is verified here, so connect only one you trust for them.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [...writeAccess],
  request: { body: json(createSamlConnectionBody) },
  responses: {
    200: jsonResponse("Created", samlConnectionSchema),
    400: errorResponse("Invalid request, or an unusable certificate"),
    403: forbiddenOrStale,
    409: errorResponse(
      "A domain belongs to another connection, or the key is taken",
    ),
    429: tooOften,
  },
});

const updateSamlRoute = createRoute({
  method: "patch",
  operationId: "updateSamlConnection",
  path: "/saml/{id}",
  tags: TAGS,
  summary: "Change a SAML connection",
  description: `For example, a new signing certificate. The addresses on the identity provider's side stay the same.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [...writeAccess],
  request: {
    params: identityConnectionParam,
    body: json(updateSamlConnectionBody),
  },
  responses: {
    200: jsonResponse("Changed", samlConnectionSchema),
    400: errorResponse("Invalid request, or an unusable certificate"),
    403: forbiddenOrStale,
    404: notFound,
    409: errorResponse("A domain belongs to another connection"),
    429: tooOften,
  },
});

const deleteSamlRoute = createRoute({
  method: "delete",
  operationId: "deleteSamlConnection",
  path: "/saml/{id}",
  tags: TAGS,
  summary: "Remove a SAML connection",
  description: `Stops sign-in through this identity provider. Accounts stay, and their owners sign in another way.${ADMIN_NOTE}${REAUTH_NOTE}`,
  middleware: [...writeAccess],
  request: { params: identityConnectionParam },
  responses: {
    200: jsonResponse("Removed", identityConnectionDeletedSchema),
    403: forbiddenOrStale,
    404: notFound,
    429: tooOften,
  },
});

const identity = apiRouter()
  .openapi(listScimRoute, async (c) => c.json(await listScimConnections(), 200))
  .openapi(createScimRoute, async (c) =>
    c.json(
      await createScimConnection(c.req.valid("json"), c.get("userId")),
      200,
    ),
  )
  .openapi(rotateScimRoute, async (c) =>
    c.json(
      await rotateScimConnectionToken(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  )
  .openapi(deleteScimRoute, async (c) =>
    c.json(
      await deleteScimConnection(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  )
  .openapi(listSamlRoute, async (c) => c.json(await listSamlConnections(), 200))
  .openapi(draftSamlRoute, (c) => c.json(draftSamlConnection(), 200))
  .openapi(createSamlRoute, async (c) =>
    c.json(
      await createSamlConnection(c.req.valid("json"), c.get("userId")),
      200,
    ),
  )
  .openapi(updateSamlRoute, async (c) =>
    c.json(
      await updateSamlConnection(
        c.req.valid("param").id,
        c.req.valid("json"),
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(deleteSamlRoute, async (c) =>
    c.json(
      await deleteSamlConnection(c.req.valid("param").id, c.get("userId")),
      200,
    ),
  );

export default identity;
