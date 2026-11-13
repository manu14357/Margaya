import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { ACCESS_MARKER } from "../api-key/scope";
import db from "../database";
import { apikeyTable } from "../database/schema";

// Every Slack action runs as the linked Margaya user through the API's own
// routes, so the normal workspace, role, restricted-project and two-factor
// checks decide what it may do. There is no bot identity with workspace-wide
// rights: each action mints a key for that user that lives for one action,
// can only reach the areas Slack needs, and is deleted right after.

type AppFetch = (
  request: Request,
  env?: unknown,
) => Response | Promise<Response>;

let appFetch: AppFetch | null = null;

/** Registered once by createApp() with the app's own fetch. */
export function setSlackApiFetch(fetch: AppFetch | null): void {
  appFetch = fetch;
}

export const SLACK_KEY_PREFIX = "mgslack_";
const KEY_TTL_MS = 2 * 60 * 1000;

// The most a Slack action may do; the user's own role still applies on top.
export const SLACK_KEY_STATEMENTS: Record<string, string[]> = {
  [ACCESS_MARKER]: ["custom"],
  project: ["read"],
  task: ["create", "read", "update", "assign"],
  label: ["create", "read"],
  workspace: ["read"],
  intake: ["create", "read"],
};

function hashKey(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export type UserApi = <T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<ApiResult<T>>;

function errorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message.slice(0, 200);
  } catch {
    // Plain-text errors.
  }
  return text.slice(0, 200);
}

function userApi(token: string): UserApi {
  return async (method, path, body) => {
    const fetch = appFetch;
    if (!fetch) return { ok: false, status: 500, message: "API not ready" };
    const headers = new Headers({
      "x-api-key": token,
      accept: "application/json",
      "user-agent": "Margaya Slack app",
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

/** Runs `work` as `userId` with a one-action key that is always revoked. */
export async function asLinkedUser<T>(
  userId: string,
  work: (api: UserApi) => Promise<T>,
): Promise<T> {
  const token = `${SLACK_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const [row] = await db
    .insert(apikeyTable)
    .values({
      name: "Slack",
      start: token.slice(0, 12),
      prefix: SLACK_KEY_PREFIX,
      key: hashKey(token),
      referenceId: userId,
      userId,
      enabled: true,
      rateLimitEnabled: false,
      expiresAt: new Date(now.getTime() + KEY_TTL_MS),
      createdAt: now,
      updatedAt: now,
      permissions: JSON.stringify(SLACK_KEY_STATEMENTS),
    })
    .returning({ id: apikeyTable.id });
  if (!row) throw new Error("Could not mint a Slack action key");
  try {
    return await work(userApi(token));
  } finally {
    await db
      .delete(apikeyTable)
      .where(eq(apikeyTable.id, row.id))
      .catch(() => {
        // Expires on its own within minutes.
      });
  }
}
