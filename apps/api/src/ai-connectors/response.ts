import { responseTimestamp, z } from "../openapi";

// Response schemas of the connector routes (ai-connectors/index.ts).

export const aiConnectorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    shared: z.boolean().openapi({
      description: "Shared with the workspace; otherwise personal.",
    }),
    ownerId: z.string().nullable().openapi({
      description: "The person a personal connector belongs to.",
    }),
    url: z.string().nullable().openapi({
      description:
        "Only for people who may change the connector (its owner, or ai:manage for shared ones).",
    }),
    authType: z.enum(["none", "header"]),
    headerName: z.string().nullable(),
    hasSecret: z.boolean(),
    secretLast4: z.string().nullable().openapi({
      description:
        "The secret's last four characters, for people who may change the connector. The secret itself is never returned.",
    }),
    enabled: z.boolean(),
    canManage: z.boolean(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AiConnector");

export const aiConnectorListSchema = z.array(aiConnectorSchema);

export const connectorTestSchema = z
  .object({
    ok: z.boolean(),
    error: z
      .enum([
        "DESTINATION",
        "TIMEOUT",
        "NETWORK",
        "HTTP",
        "TOO_LARGE",
        "PROTOCOL",
        "RPC",
        "SECRET_UNREADABLE",
      ])
      .nullable()
      .openapi({
        description:
          "Why the connection failed: DESTINATION (not a public address), TIMEOUT, NETWORK, HTTP (an error status, see httpStatus), TOO_LARGE, PROTOCOL or RPC (not a working MCP server), SECRET_UNREADABLE (AUTH_SECRET changed; enter the secret again).",
      }),
    httpStatus: z.number().int().nullable(),
    tools: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        readOnly: z.boolean(),
      }),
    ),
  })
  .openapi("AiConnectorTest");

export const deletedConnectorSchema = z
  .object({ id: z.string() })
  .openapi("DeletedAiConnector");
