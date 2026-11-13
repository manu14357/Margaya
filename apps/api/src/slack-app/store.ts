import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import { slackConnectionTable, slackUserLinkTable } from "../database/schema";
import { openSlackSecret } from "./secrets";

export type SlackMode = "socket" | "http";
export const SLACK_MODES = ["socket", "http"] as const;

export type SlackConnectionRow = typeof slackConnectionTable.$inferSelect;

/** A connection with its credentials opened, for server-side use only. */
export type LoadedSlackConnection = {
  id: string;
  workspaceId: string;
  mode: SlackMode;
  botToken: string;
  appToken: string | null;
  signingSecret: string | null;
  teamId: string | null;
  botUserId: string | null;
  defaultProjectId: string | null;
  expandTaskKeys: boolean;
  isActive: boolean;
  updatedAt: Date;
};

export function asMode(value: string): SlackMode {
  return value === "http" ? "http" : "socket";
}

function open(sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return openSlackSecret(sealed);
  } catch {
    // AUTH_SECRET changed: the credential must be entered again.
    return null;
  }
}

export function loadConnectionRow(
  row: SlackConnectionRow,
): LoadedSlackConnection | null {
  const botToken = open(row.botToken);
  if (!botToken) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    mode: asMode(row.mode),
    botToken,
    appToken: open(row.appToken),
    signingSecret: open(row.signingSecret),
    teamId: row.teamId,
    botUserId: row.botUserId,
    defaultProjectId: row.defaultProjectId,
    expandTaskKeys: row.expandTaskKeys,
    isActive: row.isActive,
    updatedAt: row.updatedAt,
  };
}

export async function getConnectionRow(
  workspaceId: string,
): Promise<SlackConnectionRow | null> {
  const [row] = await db
    .select()
    .from(slackConnectionTable)
    .where(eq(slackConnectionTable.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/** The workspace's active connection with credentials, or null. */
export async function loadActiveConnection(
  workspaceId: string,
): Promise<LoadedSlackConnection | null> {
  const row = await getConnectionRow(workspaceId);
  if (!row?.isActive) return null;
  return loadConnectionRow(row);
}

export async function listActiveSocketConnections(): Promise<
  SlackConnectionRow[]
> {
  return db
    .select()
    .from(slackConnectionTable)
    .where(
      and(
        eq(slackConnectionTable.isActive, true),
        eq(slackConnectionTable.mode, "socket"),
      ),
    );
}

export async function recordConnectionStatus(
  connectionId: string,
  status: { connected: true } | { connected: false; error: string },
): Promise<void> {
  // updatedAt is the config fingerprint the socket manager watches, so it
  // is pinned to its current value instead of the automatic bump.
  const keep = { updatedAt: sql`${slackConnectionTable.updatedAt}` };
  await db
    .update(slackConnectionTable)
    .set(
      status.connected
        ? { lastConnectedAt: new Date(), lastError: null, ...keep }
        : { lastError: status.error.slice(0, 200), ...keep },
    )
    .where(eq(slackConnectionTable.id, connectionId));
}

export async function findLinkedUserId(input: {
  workspaceId: string;
  teamId: string;
  slackUserId: string;
}): Promise<string | null> {
  const [row] = await db
    .select({ userId: slackUserLinkTable.userId })
    .from(slackUserLinkTable)
    .where(
      and(
        eq(slackUserLinkTable.workspaceId, input.workspaceId),
        eq(slackUserLinkTable.slackTeamId, input.teamId),
        eq(slackUserLinkTable.slackUserId, input.slackUserId),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}
