import { auditContext } from "../audit-log/context";

// An instance admin's own session reaches every workspace and the Better
// Auth admin endpoints. Their API keys do not, unless the operator opts in
// with ALLOW_INSTANCE_ADMIN_API_KEYS=true: a leaked automation key must not
// carry instance-wide power. Such a key still works like any member's key
// in the workspaces its owner belongs to.

export function instanceAdminApiKeysAllowed(): boolean {
  return process.env.ALLOW_INSTANCE_ADMIN_API_KEYS === "true";
}

/**
 * Whether the request in flight authenticated with an API key. Read from
 * the request store so helpers called without the Hono context see it too.
 */
export function currentRequestUsesApiKey(): boolean {
  const c = auditContext.getStore()?.c;
  return Boolean(c?.get("apiKey"));
}
