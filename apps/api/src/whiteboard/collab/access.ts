import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { auditContext } from "../../audit-log/context";
import db from "../../database";
import { userTable } from "../../database/schema";
import { credentialsValid } from "../../page/collab/access";
import { COLLAB_CLOSE } from "../../page/collab/limits";
import { featureDisabledMessage } from "../../project/features";
import { validateWorkspaceAccess } from "../../utils/validate-workspace-access";
import { WHITEBOARD_MESSAGES, type WhiteboardCaller } from "../rules";
import { whiteboardCallerOf } from "../shared";
import { type BoardMeta, readBoardMeta } from "./meta";
import type { BoardConnectionIdentity, BoardRevalidateResult } from "./room";

// Who may open a board socket, and the periodic re-check of an open one.
// The handshake answers like the REST routes: a missing, trashed or foreign
// board (or one in a restricted project the caller can't see) is 404;
// missing whiteboard:read or Whiteboards turned off is 403.

const WINDOW_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type BoardSocketGrant = {
  identity: BoardConnectionIdentity;
  caller: WhiteboardCaller;
};

function notFound(): HTTPException {
  return new HTTPException(404, { message: WHITEBOARD_MESSAGES.notFound });
}

type ApiKeyVariable =
  | {
      id: string;
      permissions?: Record<string, string[]> | null;
      projectIds?: string[] | null;
    }
  | undefined;

/**
 * Checks an authenticated upgrade request for the board socket. Throws
 * HTTPException (nothing upgrades).
 */
export async function authorizeBoardSocket(
  c: Context,
  whiteboardId: string,
): Promise<BoardSocketGrant> {
  const userId: string = c.get("userId");
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });

  const result = await readBoardMeta(whiteboardId);
  if (result.status === "gone") throw notFound();
  const { meta } = result;

  const apiKey = c.get("apiKey") as ApiKeyVariable;
  try {
    await validateWorkspaceAccess(
      userId,
      meta.workspaceId,
      apiKey?.id,
      meta.projectId,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) {
      throw notFound();
    }
    throw error;
  }
  c.set("workspaceId", meta.workspaceId);
  c.set("projectId", meta.projectId);

  const caller = await whiteboardCallerOf(c);
  if (!caller.canRead) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  if (result.status === "feature-off") {
    throw new HTTPException(403, {
      message: featureDisabledMessage("whiteboards"),
    });
  }

  const [account] = await db
    .select({ name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const windowId = c.req.query("windowId");
  const session = c.get("session") as { id?: string } | null | undefined;
  return {
    identity: {
      userId,
      name: account?.name ?? "",
      image: account?.image ?? null,
      workspaceId: meta.workspaceId,
      sessionId: apiKey ? null : (session?.id ?? null),
      apiKeyId: apiKey?.id ?? null,
      apiKeyPermissions: apiKey?.permissions ?? null,
      apiKeyProjectIds: apiKey?.projectIds ?? null,
      initiatorId:
        windowId && WINDOW_ID_PATTERN.test(windowId)
          ? `${userId}:${windowId}`
          : userId,
    },
    caller,
  };
}

/**
 * The permission lookups read request variables only, so the socket's
 * cached identity stands in for a request when it is re-checked later.
 */
function identityContext(
  identity: BoardConnectionIdentity,
  meta: BoardMeta,
): Context {
  const variables: Record<string, unknown> = {
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    projectId: meta.projectId,
    apiKey: identity.apiKeyId
      ? { id: identity.apiKeyId, permissions: identity.apiKeyPermissions }
      : undefined,
  };
  return { get: (key: string) => variables[key] } as unknown as Context;
}

/**
 * Re-reads what an open socket relies on: its credentials (4401), its
 * workspace membership, project reach and whiteboard permissions (4403).
 * Runs outside the request that triggered it, so that request's memoized
 * roles say nothing about this socket.
 */
export function revalidateBoardConnection(
  identity: BoardConnectionIdentity,
  meta: BoardMeta,
): Promise<BoardRevalidateResult> {
  return auditContext.exit(() => revalidate(identity, meta));
}

async function revalidate(
  identity: BoardConnectionIdentity,
  meta: BoardMeta,
): Promise<BoardRevalidateResult> {
  if (!(await credentialsValid(identity))) {
    return {
      status: "close",
      code: COLLAB_CLOSE.unauthorized,
      reason: "Session ended",
    };
  }
  const lost: BoardRevalidateResult = {
    status: "close",
    code: COLLAB_CLOSE.forbidden,
    reason: WHITEBOARD_MESSAGES.notFound,
  };
  if (meta.workspaceId !== identity.workspaceId) return lost;
  const keyProjects = identity.apiKeyProjectIds;
  if (keyProjects?.length && !keyProjects.includes(meta.projectId)) return lost;
  try {
    await validateWorkspaceAccess(
      identity.userId,
      meta.workspaceId,
      identity.apiKeyId ?? undefined,
      meta.projectId,
    );
  } catch (error) {
    if (error instanceof HTTPException) return lost;
    throw error;
  }
  const caller = await whiteboardCallerOf(identityContext(identity, meta));
  if (!caller.canRead) return lost;
  return { status: "ok", caller };
}
