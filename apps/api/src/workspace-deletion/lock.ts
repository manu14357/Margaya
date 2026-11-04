import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { auditContext } from "../audit-log/context";
import db from "../database";
import { workspaceTable } from "../database/schema";

// While a deletion is pending the workspace is read-only for everyone, and
// API keys (and the integrations built on them) stop working altogether.
// `validateWorkspaceAccess` calls this for every workspace-scoped request;
// reads by signed-in people never pay for the lookup.

export const WORKSPACE_LOCKED_MESSAGE =
  "This workspace is scheduled for deletion and is read-only. Its owner can cancel the deletion.";
export const WORKSPACE_LOCKED_API_KEY_MESSAGE =
  "This workspace is scheduled for deletion. API keys and integrations are paused.";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// POST routes that only read, and the deletion routes themselves (cancel).
// Exports stay possible so people can take their data with them.
const EXEMPT_PATHS = [
  /^\/api\/task-query\/?$/,
  /^\/api\/analytics\/(chart|trend)$/,
  /^\/api\/estimate\/[^/]+\/totals$/,
  /^\/api\/task-export(\/workspace)?\/?$/,
  /^\/api\/workspace\/[^/]+\/deletion$/,
];

export function isLockExemptRequest(method: string, path: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  return EXEMPT_PATHS.some((pattern) => pattern.test(path));
}

/** Whether a deletion is pending for the workspace. */
export async function isWorkspacePendingDeletion(
  workspaceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ dueAt: workspaceTable.deletionDueAt })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return Boolean(row?.dueAt);
}

/**
 * The workspaces among `workspaceIds` that are pending deletion. Inbound
 * repository webhooks use it to skip their projects during the grace period.
 */
export async function workspacesPendingDeletion(
  workspaceIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(workspaceIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(
      and(
        inArray(workspaceTable.id, ids),
        isNotNull(workspaceTable.deletionDueAt),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/**
 * Throws 403 for an API key and 423 for a write while the workspace is
 * pending deletion. Calls outside a request (background jobs) pass.
 */
export async function assertWorkspaceNotLocked(
  workspaceId: string,
  apiKeyId?: string,
): Promise<void> {
  const c = auditContext.getStore()?.c;
  const viaApiKey = Boolean(apiKeyId) || Boolean(c?.get("apiKey"));
  if (!viaApiKey && (!c || isLockExemptRequest(c.req.method, c.req.path))) {
    return;
  }
  if (!(await isWorkspacePendingDeletion(workspaceId))) return;
  if (viaApiKey) {
    throw new HTTPException(403, {
      message: WORKSPACE_LOCKED_API_KEY_MESSAGE,
    });
  }
  throw new HTTPException(423, { message: WORKSPACE_LOCKED_MESSAGE });
}
