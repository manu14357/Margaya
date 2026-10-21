import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { ACCESS_MARKER, PROJECTS_MARKER } from "../api-key/scope";
import db from "../database";
import { apikeyTable } from "../database/schema";
import type { PermissionMap } from "./rights";

// Short-lived internal credentials. Every agent tool calls the API's own
// routes in-process with a key minted for one run (or one approval or undo):
// its user is the agent, its statements are the capped rights, its projects
// are the run's scope. The token never leaves this process and the row is
// deleted when the work ends; it also expires on its own.

type AppFetch = (
  request: Request,
  env?: unknown,
) => Response | Promise<Response>;

let appFetch: AppFetch | null = null;

/** Registered once by createApp() with the app's own fetch. */
export function setAgentApiFetch(fetch: AppFetch | null): void {
  appFetch = fetch;
}

/** Key metadata markers; verified against ai_run before they count. */
export const RUN_MARKER = "margaya:agentRun";
export const ON_BEHALF_MARKER = "margaya:onBehalfOf";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function hashKey(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export type RunKey = { id: string; token: string };

export async function mintRunKey(input: {
  runId: string;
  agentUserId: string;
  onBehalfOf: string;
  statements: PermissionMap;
  projectIds: readonly string[];
  ttlMs?: number;
}): Promise<RunKey> {
  if (input.projectIds.length === 0) {
    // An empty project list would read as "every project".
    throw new Error("A run key needs at least one project");
  }
  const token = `mgagent_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const permissions = {
    [ACCESS_MARKER]: ["custom"],
    ...input.statements,
    [PROJECTS_MARKER]: [...new Set(input.projectIds)],
  };
  const [row] = await db
    .insert(apikeyTable)
    .values({
      name: `Agent run ${input.runId}`,
      start: token.slice(0, 12),
      prefix: "mgagent_",
      key: hashKey(token),
      referenceId: input.agentUserId,
      userId: input.agentUserId,
      enabled: true,
      rateLimitEnabled: false,
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS)),
      createdAt: now,
      updatedAt: now,
      permissions: JSON.stringify(permissions),
      metadata: JSON.stringify({
        [RUN_MARKER]: input.runId,
        [ON_BEHALF_MARKER]: input.onBehalfOf,
      }),
    })
    .returning({ id: apikeyTable.id });
  if (!row) throw new Error("Could not mint a run key");
  return { id: row.id, token };
}

export async function revokeRunKey(keyId: string | null | undefined) {
  if (!keyId) return;
  await db.delete(apikeyTable).where(eq(apikeyTable.id, keyId));
}

export type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export type AgentApi = <T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<ApiResult<T>>;

function errorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 300);
  } catch {
    // Plain-text errors.
  }
  return text.slice(0, 300);
}

/** A caller of `/api/...` routes with a run key. */
export function agentApi(token: string): AgentApi {
  return async (method, path, body) => {
    const fetch = appFetch;
    if (!fetch) return { ok: false, status: 500, message: "API not ready" };
    const headers = new Headers({
      "x-api-key": token,
      accept: "application/json",
      "user-agent": "Margaya agent",
    });
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await fetch(
      new Request(`http://127.0.0.1/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: errorMessage(text),
      };
    }
    try {
      return {
        ok: true,
        status: response.status,
        data: (text ? JSON.parse(text) : null) as never,
      };
    } catch {
      return { ok: false, status: 502, message: "Unreadable response" };
    }
  };
}

/** Runs `work` with a fresh key that is always revoked afterwards. */
export async function withRunKey<T>(
  input: Parameters<typeof mintRunKey>[0],
  work: (api: AgentApi, key: RunKey) => Promise<T>,
): Promise<T> {
  const key = await mintRunKey(input);
  try {
    return await work(agentApi(key.token), key);
  } finally {
    await revokeRunKey(key.id).catch((error) => {
      console.error("agents: could not revoke a run key", {
        error: error instanceof Error ? error.name : "unknown",
      });
    });
  }
}
