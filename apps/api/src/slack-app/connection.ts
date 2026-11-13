import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, slackConnectionTable } from "../database/schema";
import { buildSlackManifest, slackEventsUrl, unfurlDomain } from "./manifest";
import {
  maskSealedSlackSecret,
  openSlackSecret,
  sealSlackSecret,
} from "./secrets";
import { refreshSlackSockets } from "./socket";
import {
  asMode,
  getConnectionRow,
  type SlackConnectionRow,
  type SlackMode,
} from "./store";
import { callSlack, SlackApiError } from "./web-api";

// The workspace's Slack app settings: create, update, test and remove.

function readable(row: SlackConnectionRow): boolean {
  try {
    openSlackSecret(row.botToken);
    return true;
  } catch {
    return false;
  }
}

export function toConnectionResponse(row: SlackConnectionRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    mode: asMode(row.mode),
    teamId: row.teamId,
    teamName: row.teamName,
    botUserId: row.botUserId,
    botTokenConfigured: Boolean(row.botToken),
    maskedBotToken: maskSealedSlackSecret(row.botToken),
    appTokenConfigured: Boolean(row.appToken),
    maskedAppToken: maskSealedSlackSecret(row.appToken),
    signingSecretConfigured: Boolean(row.signingSecret),
    maskedSigningSecret: maskSealedSlackSecret(row.signingSecret),
    credentialsReadable: readable(row),
    defaultProjectId: row.defaultProjectId,
    expandTaskKeys: row.expandTaskKeys,
    isActive: row.isActive,
    lastConnectedAt: row.lastConnectedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSlackAppState(workspaceId: string) {
  const row = await getConnectionRow(workspaceId);
  const expandTaskKeys = row?.expandTaskKeys ?? false;
  const manifest = (mode: SlackMode) =>
    JSON.stringify(
      buildSlackManifest({ mode, workspaceId, expandTaskKeys }),
      null,
      2,
    );
  return {
    connection: row ? toConnectionResponse(row) : null,
    setup: {
      eventsUrl: slackEventsUrl(workspaceId),
      unfurlDomain: unfurlDomain(),
      manifests: { socket: manifest("socket"), http: manifest("http") },
    },
  };
}

async function assertProjectInWorkspace(
  projectId: string | null | undefined,
  workspaceId: string,
) {
  if (!projectId) return;
  const [project] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project) {
    throw new HTTPException(400, {
      message: "defaultProjectId: not a project of this workspace",
    });
  }
}

function assertModeCredentials(
  mode: SlackMode,
  has: { appToken: boolean; signingSecret: boolean },
) {
  if (mode === "socket" && !has.appToken) {
    throw new HTTPException(400, {
      message: "appToken: Socket Mode needs an app-level token (xapp-…)",
    });
  }
  if (mode === "http" && !has.signingSecret) {
    throw new HTTPException(400, {
      message: "signingSecret: HTTP mode needs the app's signing secret",
    });
  }
}

export async function createSlackConnection(
  workspaceId: string,
  userId: string,
  body: {
    mode: SlackMode;
    botToken: string;
    appToken?: string;
    signingSecret?: string;
    defaultProjectId?: string | null;
    expandTaskKeys?: boolean;
  },
) {
  assertModeCredentials(body.mode, {
    appToken: Boolean(body.appToken),
    signingSecret: Boolean(body.signingSecret),
  });
  await assertProjectInWorkspace(body.defaultProjectId, workspaceId);
  const values = {
    mode: body.mode,
    botToken: sealSlackSecret(body.botToken),
    appToken: body.appToken ? sealSlackSecret(body.appToken) : null,
    signingSecret: body.signingSecret
      ? sealSlackSecret(body.signingSecret)
      : null,
    defaultProjectId: body.defaultProjectId ?? null,
    expandTaskKeys: body.expandTaskKeys ?? false,
    isActive: true,
    // A new bot token may belong to another Slack team.
    teamId: null,
    teamName: null,
    botUserId: null,
    lastConnectedAt: null,
    lastError: null,
  };
  await db
    .insert(slackConnectionTable)
    .values({ workspaceId, createdBy: userId, ...values })
    .onConflictDoUpdate({
      target: slackConnectionTable.workspaceId,
      set: { ...values, updatedAt: new Date() },
    });
  void refreshSlackSockets();
  return getSlackAppState(workspaceId);
}

export async function updateSlackConnection(
  workspaceId: string,
  body: {
    mode?: SlackMode;
    botToken?: string;
    appToken?: string;
    signingSecret?: string;
    defaultProjectId?: string | null;
    expandTaskKeys?: boolean;
    isActive?: boolean;
  },
) {
  const row = await getConnectionRow(workspaceId);
  if (!row) {
    throw new HTTPException(404, { message: "Slack app not connected" });
  }
  const mode = body.mode ?? asMode(row.mode);
  assertModeCredentials(mode, {
    appToken: Boolean(body.appToken || row.appToken),
    signingSecret: Boolean(body.signingSecret || row.signingSecret),
  });
  if (body.defaultProjectId !== undefined) {
    await assertProjectInWorkspace(body.defaultProjectId, workspaceId);
  }
  // Omitted fields keep their stored value, so a client never reads a
  // secret back to save the form.
  await db
    .update(slackConnectionTable)
    .set({
      mode,
      ...(body.botToken
        ? {
            botToken: sealSlackSecret(body.botToken),
            teamId: null,
            teamName: null,
            botUserId: null,
          }
        : {}),
      ...(body.appToken ? { appToken: sealSlackSecret(body.appToken) } : {}),
      ...(body.signingSecret
        ? { signingSecret: sealSlackSecret(body.signingSecret) }
        : {}),
      ...(body.defaultProjectId !== undefined
        ? { defaultProjectId: body.defaultProjectId }
        : {}),
      ...(body.expandTaskKeys !== undefined
        ? { expandTaskKeys: body.expandTaskKeys }
        : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(slackConnectionTable.id, row.id));
  void refreshSlackSockets();
  return getSlackAppState(workspaceId);
}

export async function deleteSlackConnection(workspaceId: string) {
  const removed = await db
    .delete(slackConnectionTable)
    .where(eq(slackConnectionTable.workspaceId, workspaceId))
    .returning({ id: slackConnectionTable.id });
  if (removed.length === 0) {
    throw new HTTPException(404, { message: "Slack app not connected" });
  }
  // Account links stay: reconnecting the same Slack team keeps them working.
  void refreshSlackSockets();
}

type Check = {
  check: "bot_token" | "app_token" | "signing_secret";
  ok: boolean;
  error: string | null;
};

function codeOf(error: unknown): string {
  return error instanceof SlackApiError ? error.code : "unknown_error";
}

/** Checks the stored credentials against Slack and records the team. */
export async function testSlackConnection(workspaceId: string) {
  const row = await getConnectionRow(workspaceId);
  if (!row) {
    throw new HTTPException(404, { message: "Slack app not connected" });
  }
  const open = (sealed: string | null) => {
    if (!sealed) return null;
    try {
      return openSlackSecret(sealed);
    } catch {
      return null;
    }
  };
  const checks: Check[] = [];
  let teamName: string | null = null;

  const botToken = open(row.botToken);
  if (!botToken) {
    checks.push({ check: "bot_token", ok: false, error: "unreadable" });
  } else {
    try {
      const result = await callSlack<{
        team?: string;
        team_id?: string;
        user_id?: string;
      }>(botToken, "auth.test");
      teamName = result.team ?? null;
      checks.push({ check: "bot_token", ok: true, error: null });
      if (
        result.team_id !== row.teamId ||
        result.team !== row.teamName ||
        result.user_id !== row.botUserId
      ) {
        // A bumped updatedAt restarts the socket with the team it now knows.
        await db
          .update(slackConnectionTable)
          .set({
            teamId: result.team_id ?? null,
            teamName: result.team ?? null,
            botUserId: result.user_id ?? null,
            updatedAt: new Date(),
          })
          .where(eq(slackConnectionTable.id, row.id));
        void refreshSlackSockets();
      }
    } catch (error) {
      checks.push({ check: "bot_token", ok: false, error: codeOf(error) });
    }
  }

  if (asMode(row.mode) === "socket") {
    const appToken = open(row.appToken);
    if (!appToken) {
      checks.push({ check: "app_token", ok: false, error: "missing" });
    } else {
      try {
        await callSlack(appToken, "apps.connections.open");
        checks.push({ check: "app_token", ok: true, error: null });
      } catch (error) {
        checks.push({ check: "app_token", ok: false, error: codeOf(error) });
      }
    }
  } else {
    // Slack can't be asked to sign a request on demand; the secret is
    // checked on every incoming request instead.
    const secret = open(row.signingSecret);
    checks.push({
      check: "signing_secret",
      ok: Boolean(secret),
      error: secret ? null : "missing",
    });
  }

  return { ok: checks.every((check) => check.ok), teamName, checks };
}
