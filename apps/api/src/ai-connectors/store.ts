import { and, asc, count, eq, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import { aiConnectorTable } from "../database/schema";
import { assertPublicDestination } from "../utils/assert-public-destination";
import {
  openSecret,
  SecretUnreadableError,
  sealSecret,
} from "../utils/secret-box";
import { McpConnection, McpError, type McpTool } from "./mcp-client";

// Outbound MCP connectors: shared with the workspace (userId null, managed
// with ai:manage) or personal to one member. Secrets are sealed with the
// secret box and never leave the server; responses show the last four
// characters to the people who may change the connector.

export const MAX_CONNECTORS_PER_WORKSPACE = 50;
const SECRET_PURPOSE = "ai-connector-secret";
const DEFAULT_HEADER = "Authorization";

export type ConnectorRow = typeof aiConnectorTable.$inferSelect;

type Actor = { workspaceId: string; userId: string; canManage: boolean };

/** Who may change a connector: its owner, or ai:manage for shared ones. */
function mayManage(row: ConnectorRow, actor: Actor): boolean {
  return row.userId === null ? actor.canManage : row.userId === actor.userId;
}

function secretLast4(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    const secret = openSecret(SECRET_PURPOSE, sealed);
    return secret.length >= 8 ? secret.slice(-4) : null;
  } catch {
    return null;
  }
}

export function serializeConnector(row: ConnectorRow, actor: Actor) {
  const manage = mayManage(row, actor);
  return {
    id: row.id,
    name: row.name,
    shared: row.userId === null,
    ownerId: row.userId,
    url: manage ? row.url : null,
    authType: row.authType,
    headerName: row.authType === "header" ? row.headerName : null,
    hasSecret: Boolean(row.secret),
    secretLast4: manage ? secretLast4(row.secret) : null,
    enabled: row.enabled,
    canManage: manage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Shared connectors and the person's own, in one workspace. */
function visibleTo(workspaceId: string, userId: string) {
  return and(
    eq(aiConnectorTable.workspaceId, workspaceId),
    or(isNull(aiConnectorTable.userId), eq(aiConnectorTable.userId, userId)),
  );
}

export async function listConnectors(actor: Actor) {
  const rows = await db
    .select()
    .from(aiConnectorTable)
    .where(visibleTo(actor.workspaceId, actor.userId))
    .orderBy(asc(aiConnectorTable.name), asc(aiConnectorTable.id));
  return rows.map((row) => serializeConnector(row, actor));
}

async function loadVisible(actor: Actor, connectorId: string) {
  const [row] = await db
    .select()
    .from(aiConnectorTable)
    .where(
      and(
        eq(aiConnectorTable.id, connectorId),
        visibleTo(actor.workspaceId, actor.userId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Connector not found" });
  return row;
}

async function loadManaged(actor: Actor, connectorId: string) {
  const row = await loadVisible(actor, connectorId);
  if (!mayManage(row, actor)) {
    throw new HTTPException(403, {
      message:
        "Only its owner, or people with ai:manage for shared connectors, can change it",
    });
  }
  return row;
}

async function assertDestination(url: string) {
  try {
    await assertPublicDestination(url, "Connector");
  } catch {
    throw new HTTPException(400, {
      message: "url: the connector must be reachable at a public address",
    });
  }
}

type ConnectorFields = {
  name: string;
  url: string;
  authType: "none" | "header";
  headerName?: string | null;
  secret?: string | null;
  enabled?: boolean;
};

export async function createConnector(
  actor: Actor,
  input: ConnectorFields & { shared: boolean },
) {
  if (input.shared && !actor.canManage) {
    throw new HTTPException(403, {
      message: "Shared connectors need ai:manage",
    });
  }
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(aiConnectorTable)
    .where(eq(aiConnectorTable.workspaceId, actor.workspaceId));
  if (Number(value) >= MAX_CONNECTORS_PER_WORKSPACE) {
    throw new HTTPException(409, {
      message: `A workspace can have at most ${MAX_CONNECTORS_PER_WORKSPACE} connectors`,
    });
  }
  await assertDestination(input.url);
  const header = input.authType === "header";
  const [row] = await db
    .insert(aiConnectorTable)
    .values({
      workspaceId: actor.workspaceId,
      userId: input.shared ? null : actor.userId,
      name: input.name.trim(),
      url: input.url,
      authType: input.authType,
      headerName: header ? input.headerName || DEFAULT_HEADER : null,
      secret:
        header && input.secret
          ? sealSecret(SECRET_PURPOSE, input.secret)
          : null,
      enabled: input.enabled ?? true,
      createdBy: actor.userId,
    })
    .returning();
  if (!row) throw new HTTPException(500, { message: "Could not save" });
  await recordAudit({
    workspaceId: actor.workspaceId,
    action: "ai.connector_created",
    target: { type: "ai_connector", id: row.id, label: row.name },
    metadata: { shared: row.userId === null, authType: row.authType },
  });
  return serializeConnector(row, actor);
}

export async function updateConnector(
  actor: Actor,
  connectorId: string,
  patch: Partial<ConnectorFields>,
) {
  const current = await loadManaged(actor, connectorId);
  const values: Partial<typeof aiConnectorTable.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.url !== undefined && patch.url !== current.url) {
    await assertDestination(patch.url);
    values.url = patch.url;
  }
  const authType = patch.authType ?? current.authType;
  if (patch.authType !== undefined) values.authType = patch.authType;
  if (authType === "none") {
    values.headerName = null;
    values.secret = null;
  } else {
    if (patch.headerName !== undefined || !current.headerName) {
      values.headerName = patch.headerName || DEFAULT_HEADER;
    }
    if (patch.secret !== undefined) {
      values.secret = patch.secret
        ? sealSecret(SECRET_PURPOSE, patch.secret)
        : null;
    }
  }
  if (patch.enabled !== undefined) values.enabled = patch.enabled;
  const [row] = await db
    .update(aiConnectorTable)
    .set(values)
    .where(eq(aiConnectorTable.id, current.id))
    .returning();
  if (!row) throw new HTTPException(404, { message: "Connector not found" });
  await recordAudit({
    workspaceId: actor.workspaceId,
    action: "ai.connector_updated",
    target: { type: "ai_connector", id: row.id, label: row.name },
    // Field names only: never the secret.
    metadata: { fields: Object.keys(patch), shared: row.userId === null },
  });
  return serializeConnector(row, actor);
}

export async function deleteConnector(actor: Actor, connectorId: string) {
  const current = await loadManaged(actor, connectorId);
  await db.delete(aiConnectorTable).where(eq(aiConnectorTable.id, current.id));
  await recordAudit({
    workspaceId: actor.workspaceId,
    action: "ai.connector_deleted",
    target: { type: "ai_connector", id: current.id, label: current.name },
    metadata: { shared: current.userId === null },
  });
  return { id: current.id };
}

/** The connector's endpoint with its auth header opened. */
export function endpointOf(row: ConnectorRow) {
  const headers: Record<string, string> = {};
  if (row.authType === "header" && row.secret) {
    headers[row.headerName || DEFAULT_HEADER] = openSecret(
      SECRET_PURPOSE,
      row.secret,
    );
  }
  return { url: row.url, headers };
}

export type ConnectorTestResult = {
  ok: boolean;
  error: McpError["code"] | "SECRET_UNREADABLE" | null;
  httpStatus: number | null;
  tools: { name: string; description: string; readOnly: boolean }[];
};

/** Connects and lists the tools, reporting a stable failure code. */
export async function probeConnector(
  row: ConnectorRow,
): Promise<{ result: ConnectorTestResult; tools: McpTool[] }> {
  try {
    const connection = await McpConnection.connect(endpointOf(row));
    const tools = await connection.listTools();
    return {
      tools,
      result: {
        ok: true,
        error: null,
        httpStatus: null,
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description.slice(0, 300),
          readOnly: tool.readOnly,
        })),
      },
    };
  } catch (error) {
    if (error instanceof SecretUnreadableError) {
      return {
        tools: [],
        result: {
          ok: false,
          error: "SECRET_UNREADABLE",
          httpStatus: null,
          tools: [],
        },
      };
    }
    if (!(error instanceof McpError)) throw error;
    return {
      tools: [],
      result: {
        ok: false,
        error: error.code,
        httpStatus: error.status ?? null,
        tools: [],
      },
    };
  }
}

export async function testConnector(actor: Actor, connectorId: string) {
  const row = await loadManaged(actor, connectorId);
  return (await probeConnector(row)).result;
}

/**
 * Enabled connectors a run may use: the workspace's shared ones and the
 * person's own.
 */
export async function usableConnectors(
  workspaceId: string,
  userId: string,
): Promise<ConnectorRow[]> {
  return db
    .select()
    .from(aiConnectorTable)
    .where(
      and(visibleTo(workspaceId, userId), eq(aiConnectorTable.enabled, true)),
    )
    .orderBy(asc(aiConnectorTable.name), asc(aiConnectorTable.id));
}

/** One usable connector, or null when it is gone, off or not theirs. */
export async function usableConnector(
  workspaceId: string,
  userId: string,
  connectorId: string,
): Promise<ConnectorRow | null> {
  const [row] = await db
    .select()
    .from(aiConnectorTable)
    .where(
      and(
        eq(aiConnectorTable.id, connectorId),
        visibleTo(workspaceId, userId),
        eq(aiConnectorTable.enabled, true),
      ),
    )
    .limit(1);
  return row ?? null;
}
