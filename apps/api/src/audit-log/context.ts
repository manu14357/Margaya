import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "hono";

// The request an audited action happens in. Event subscribers run inside the
// publisher's async context, so they see the same store as the HTTP capture.

// Set by clientIpMiddleware from the transport peer and TRUSTED_PROXIES;
// any client-sent copy is dropped there.
const CLIENT_IP_HEADER = "x-margaya-client-ip";
const MAX_USER_AGENT = 512;

export type AuditActorHint = {
  userId?: string | null;
  apiKeyId?: string | null;
};

export type AuditRequestStore = {
  /** Read lazily: authentication runs after the store is created. */
  c?: Context;
  ip: string | null;
  userAgent: string | null;
  /** Resolved up front where the Hono context carries no user (auth routes). */
  actor?: AuditActorHint & { activeWorkspaceId?: string | null };
  /** task.purged events of this request, written as one entry at its end. */
  purgedTasks?: { projectId: string; title: string | null }[];
};

export const auditContext = new AsyncLocalStorage<AuditRequestStore>();

export function requestStore(c: Context): AuditRequestStore {
  const userAgent = c.req.header("user-agent")?.trim() || null;
  return {
    c,
    ip: c.req.header(CLIENT_IP_HEADER)?.trim() || null,
    userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT) : null,
  };
}

/** The caller of the current request, when it is known. */
export function requestActor(store: AuditRequestStore | undefined) {
  if (!store) return null;
  if (store.actor?.userId) return store.actor;
  const c = store.c;
  if (!c) return null;
  const apiKey = c.get("apiKey") as { id: string; userId: string } | undefined;
  if (apiKey?.id) return { userId: apiKey.userId, apiKeyId: apiKey.id };
  const userId = c.get("userId") as string | undefined;
  return userId ? { userId, apiKeyId: null } : null;
}
