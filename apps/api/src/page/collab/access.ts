import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { apikeyTable, sessionTable } from "../../database/schema";
import { featureDisabledMessage } from "../../project/features";
import { validateWorkspaceAccess } from "../../utils/validate-workspace-access";
import { pageCallerOf } from "../controllers/shared";
import { canSeePage, PAGE_MESSAGES, type PageCaller } from "../rules";
import type { ConnectionIdentity } from "./connection";
import { COLLAB_CLOSE } from "./limits";
import { type PageMeta, readPageMeta } from "./meta";

// Who may open a page socket (spec §5.3), and the periodic re-check of an
// open one. The handshake answers like the page REST routes: a missing,
// foreign or invisible page is 404, a missing permission or Pages turned
// off is 403.

const WINDOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type PageSocketGrant = {
  identity: ConnectionIdentity;
  caller: PageCaller;
};

function notFound(): HTTPException {
  return new HTTPException(404, { message: PAGE_MESSAGES.notFound });
}

/**
 * Checks an authenticated upgrade request for the page socket and returns
 * the connection's identity and cached permissions. Throws HTTPException
 * (nothing upgrades).
 */
export async function authorizePageSocket(
  c: Context,
  pageId: string,
): Promise<PageSocketGrant> {
  const userId: string = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

  const result = await readPageMeta(pageId);
  if (result.status === "gone") throw notFound();
  const { meta } = result;

  const apiKey = c.get("apiKey") as
    | { id: string; permissions?: Record<string, string[]> | null }
    | undefined;
  try {
    await validateWorkspaceAccess(userId, meta.workspaceId, apiKey?.id);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw notFound();
    }
    throw error;
  }
  c.set("workspaceId", meta.workspaceId);

  const caller = await pageCallerOf(c);
  if (!caller.canRead) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  if (result.status === "feature-off") {
    throw new HTTPException(403, { message: featureDisabledMessage("pages") });
  }
  if (!canSeePage(meta, caller)) throw notFound();

  const windowId = c.req.query("windowId");
  const session = c.get("session") as { id?: string } | null | undefined;
  return {
    identity: {
      userId,
      workspaceId: meta.workspaceId,
      sessionId: apiKey ? null : (session?.id ?? null),
      apiKeyId: apiKey?.id ?? null,
      apiKeyPermissions: apiKey?.permissions ?? null,
      initiatorId:
        windowId && WINDOW_ID_PATTERN.test(windowId)
          ? `${userId}:${windowId}`
          : userId,
    },
    caller,
  };
}

/** Whether the socket's session or API key is still valid. */
async function credentialsValid(identity: ConnectionIdentity) {
  const now = new Date();
  if (identity.apiKeyId) {
    const [key] = await db
      .select({ id: apikeyTable.id })
      .from(apikeyTable)
      .where(
        and(
          eq(apikeyTable.id, identity.apiKeyId),
          eq(apikeyTable.enabled, true),
          or(isNull(apikeyTable.expiresAt), gt(apikeyTable.expiresAt, now)),
          or(
            eq(apikeyTable.referenceId, identity.userId),
            eq(apikeyTable.userId, identity.userId),
          ),
        ),
      )
      .limit(1);
    return Boolean(key);
  }
  if (!identity.sessionId) return false;
  const [session] = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.id, identity.sessionId),
        eq(sessionTable.userId, identity.userId),
        gt(sessionTable.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(session);
}

/**
 * The permission lookups only read request variables, so a socket's cached
 * identity stands in for the request when re-checking it later.
 */
function identityContext(identity: ConnectionIdentity): Context {
  const variables: Record<string, unknown> = {
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    apiKey: identity.apiKeyId
      ? { id: identity.apiKeyId, permissions: identity.apiKeyPermissions }
      : undefined,
  };
  return { get: (key: string) => variables[key] } as unknown as Context;
}

export type RevalidateResult =
  | { status: "ok"; caller: PageCaller }
  | { status: "close"; code: number; reason: string };

/**
 * Re-reads what an open socket relies on: its credentials (4401), its
 * workspace membership and page permissions, and whether it can still see
 * the page (4403).
 */
export async function revalidatePageConnection(
  identity: ConnectionIdentity,
  meta: PageMeta,
): Promise<RevalidateResult> {
  if (!(await credentialsValid(identity))) {
    return {
      status: "close",
      code: COLLAB_CLOSE.unauthorized,
      reason: "Session ended",
    };
  }
  const lost: RevalidateResult = {
    status: "close",
    code: COLLAB_CLOSE.forbidden,
    reason: PAGE_MESSAGES.notFound,
  };
  if (meta.workspaceId !== identity.workspaceId) return lost;
  try {
    await validateWorkspaceAccess(
      identity.userId,
      meta.workspaceId,
      identity.apiKeyId ?? undefined,
    );
  } catch (error) {
    if (error instanceof HTTPException) return lost;
    throw error;
  }
  const caller = await pageCallerOf(identityContext(identity));
  if (!canSeePage(meta, caller)) return lost;
  return { status: "ok", caller };
}
