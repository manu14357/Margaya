import { z } from "../openapi";

// Request schemas of the connector routes (ai-connectors/index.ts).

const workspaceId = z.string().min(1).openapi({ description: "Workspace ID" });

export const connectorWorkspaceQuery = z.object({ workspaceId });
export const connectorWorkspaceBody = z.object({ workspaceId });

export const connectorIdParam = z.object({
  connectorId: z
    .string()
    .min(1)
    .openapi({ param: { name: "connectorId", in: "path" } }),
});

// Headers a connector may not set: they belong to the HTTP exchange or the
// MCP session itself.
const RESERVED_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
  "accept",
  "connection",
  "transfer-encoding",
  "cookie",
  "mcp-session-id",
  "mcp-protocol-version",
  "user-agent",
]);

const headerName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,64}$/, "Use letters, digits and dashes")
  .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), {
    message: "This header can't be set",
  });

const fields = {
  name: z.string().trim().min(1).max(60).openapi({
    description:
      "Shown to agents as part of each tool's name, so keep it short (GitHub, Sentry).",
  }),
  url: z
    .url({ protocol: /^https?$/ })
    .max(2_000)
    .openapi({
      description:
        "The MCP server's Streamable HTTP endpoint. It must resolve to a public address.",
    }),
  authType: z.enum(["none", "header"]).openapi({
    description: "header: send the secret in a request header.",
  }),
  headerName: headerName.nullable().optional().openapi({
    description: "The header carrying the secret (default Authorization).",
  }),
  secret: z.string().min(1).max(4_000).nullable().optional().openapi({
    description:
      "The header's value, such as Bearer <token>. Stored sealed and never returned.",
  }),
  enabled: z.boolean().optional(),
};

export const createConnectorBody = z
  .strictObject({
    workspaceId,
    ...fields,
    shared: z.boolean().openapi({
      description:
        "Shared with the workspace (needs ai:manage) or only yours. Agents use shared connectors and those of the person they work for.",
    }),
  })
  .openapi("CreateAiConnector");

export const updateConnectorBody = z
  .strictObject({
    workspaceId,
    name: fields.name.optional(),
    url: fields.url.optional(),
    authType: fields.authType.optional(),
    headerName: fields.headerName,
    secret: fields.secret.openapi({
      description: "A new secret; null removes it. Left out keeps it.",
    }),
    enabled: fields.enabled,
  })
  .openapi("UpdateAiConnector");
