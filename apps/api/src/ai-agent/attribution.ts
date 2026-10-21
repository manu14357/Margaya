import { and, eq } from "drizzle-orm";
import { auditContext } from "../audit-log/context";
import db from "../database";
import { agentTable, aiRunTable, userTable } from "../database/schema";
import { ON_BEHALF_MARKER, RUN_MARKER } from "./credential";

// "Agent X on behalf of Y": a request made with a run key carries who the
// agent acts for. Activity (eventData.via), comments and the audit log read
// it from the request store, so every write an agent makes through the API
// is attributed without touching the routes.

export type AgentVia = {
  agentId: string;
  agentUserId: string;
  agentName: string;
  onBehalfOf: string;
  onBehalfOfName: string | null;
  runId: string;
};

/**
 * The attribution of an API key, or null. The markers count only when the
 * key belongs to the agent of that run: people can't create keys for agent
 * users, so they can't forge one.
 */
export async function resolveAgentVia(key: {
  userId: string;
  metadata: Record<string, unknown> | null;
}): Promise<AgentVia | null> {
  const runId = key.metadata?.[RUN_MARKER];
  const onBehalfOf = key.metadata?.[ON_BEHALF_MARKER];
  if (typeof runId !== "string" || typeof onBehalfOf !== "string") return null;
  const [row] = await db
    .select({
      agentId: agentTable.id,
      agentUserId: agentTable.userId,
      agentName: agentTable.name,
    })
    .from(aiRunTable)
    .innerJoin(agentTable, eq(agentTable.id, aiRunTable.agentId))
    .where(and(eq(aiRunTable.id, runId), eq(agentTable.userId, key.userId)))
    .limit(1);
  if (!row) return null;
  const [person] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, onBehalfOf))
    .limit(1);
  return {
    ...row,
    onBehalfOf,
    onBehalfOfName: person?.name ?? null,
    runId,
  };
}

/** The agent attribution of the request in flight, if it is an agent's. */
export function currentAgentVia(): AgentVia | null {
  const c = auditContext.getStore()?.c;
  const apiKey = c?.get("apiKey") as { agentRun?: AgentVia | null } | undefined;
  return apiKey?.agentRun ?? null;
}

/** eventData with the agent attribution added when there is one. */
export function withAgentVia(
  eventData: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const via = currentAgentVia();
  if (!via) return eventData ?? null;
  return {
    ...(eventData ?? {}),
    via: {
      agentId: via.agentId,
      agentUserId: via.agentUserId,
      agentName: via.agentName,
      onBehalfOf: via.onBehalfOf,
      onBehalfOfName: via.onBehalfOfName,
      runId: via.runId,
    },
  };
}
