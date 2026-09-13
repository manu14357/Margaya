import type { MiddlewareHandler } from "hono";
import { auth } from "../auth";
import { verifyApiKey } from "../utils/verify-api-key";
import { flushPurgedTasks } from "./capture-events";
import { type AuditRequestStore, auditContext, requestStore } from "./context";
import { matchRule, type RuleInput } from "./http-rules";
import { recordAudit } from "./record";

// Bodies above this are never parsed for the audit (the audited routes take
// small JSON bodies; large imports are matched on their path alone).
const MAX_BODY_BYTES = 64 * 1024;

async function readJsonBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return {};
  try {
    const value = await request.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function readJsonResponse(response: Response) {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return {};
  }
  try {
    const value = await response.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The caller of a Better Auth route, which runs outside the API's own
 * authentication: an API key (x-api-key or a Bearer key) or the session.
 */
async function resolveAuthActor(request: Request) {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const keyValue = request.headers.get("x-api-key")?.trim() || bearer;
  if (keyValue) {
    const verified = await verifyApiKey(keyValue).catch(() => null);
    if (verified?.valid && verified.key.userId) {
      return {
        userId: verified.key.userId,
        apiKeyId: verified.key.id,
        activeWorkspaceId: null,
      };
    }
  }
  const session = await auth.api
    .getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    })
    .catch(() => null);
  if (!session?.user) return null;
  const active = (session.session as { activeOrganizationId?: string | null })
    .activeOrganizationId;
  return {
    userId: session.user.id,
    apiKeyId: null,
    activeWorkspaceId: active ?? null,
  };
}

function purgeAction(path: string) {
  return /\/empty(-trash)?\/?$|\/trash\/empty/.test(path)
    ? "trash.emptied"
    : "trash.purged";
}

/**
 * Runs every API request inside the audit context (IP, user agent, caller)
 * and writes the entries of the audited routes once they succeed. Audit
 * failures are logged and never change the response.
 */
export function auditCapture(): MiddlewareHandler {
  return async (c, next) => {
    const store: AuditRequestStore = requestStore(c);
    const matched = matchRule(c.req.method, c.req.path);
    let input: RuleInput | undefined;
    let before: unknown;
    if (matched) {
      const { rule, match } = matched;
      try {
        const body = rule.readBody ? await readJsonBody(c.req.raw) : {};
        if (rule.auth) store.actor = (await resolveAuthActor(c.req.raw)) ?? {};
        input = { c, match, body, store };
        before = rule.before ? await rule.before(input) : undefined;
      } catch (error) {
        console.error("Audit snapshot failed:", error);
      }
    }

    await auditContext.run(store, next);

    try {
      await auditContext.run(store, async () => {
        if (store.purgedTasks?.length) {
          await flushPurgedTasks(store, purgeAction(c.req.path));
        }
        if (!matched || !input) return;
        const status = c.res.status;
        const done = matched.rule.done ?? ((s) => s >= 200 && s < 300);
        if (!done(status)) return;
        const response = await readJsonResponse(c.res);
        const entries = await matched.rule.after({
          ...input,
          before,
          response,
        });
        await recordAudit(entries);
      });
    } catch (error) {
      console.error("Audit capture failed:", error);
    }
  };
}
