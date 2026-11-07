import * as Sentry from "@sentry/node";
import { APIError } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { resolveAgentVia } from "../ai-agent/attribution";
import { readOnlyKeyAllows } from "../api-key/scope";
import { auth } from "../auth";
import { enforceApiKeyRateLimit } from "./api-key-rate-limit";
import { touchApiKeyLastUsed } from "./api-key-usage";
import {
  keyOwnerMustSetUpTwoFactor,
  mustSetUpTwoFactor,
  twoFactorRequiredError,
} from "./two-factor-policy";
import { verifyApiKey } from "./verify-api-key";

// User is tagged on Sentry's isolation scope; the per-request isolation
// scope is forked by Sentry.withIsolationScope in the api.use("*", ...)
// middleware, so this only affects the in-flight request.
function attachUserToScope(userId: string) {
  Sentry.setUser({ id: userId });
}

function isAuthRejection(error: unknown) {
  if (!(error instanceof APIError)) {
    return false;
  }
  const status = typeof error.statusCode === "number" ? error.statusCode : 0;
  return status >= 400 && status < 500;
}

async function getSession(headers: Headers) {
  try {
    return await auth.api.getSession({ headers });
  } catch (error) {
    if (isAuthRejection(error)) {
      return null;
    }
    throw error;
  }
}

async function getSessionFromBearerOnlyHeaders(c: Context) {
  const headers = new Headers(c.req.raw.headers);
  headers.delete("cookie");

  return getSession(headers);
}

function parseBearerToken(authHeader: string | undefined): {
  token: string | null;
  malformed: boolean;
} {
  if (!authHeader) {
    return { token: null, malformed: false };
  }

  if (!authHeader.match(/^Bearer\b/i)) {
    return { token: null, malformed: false };
  }

  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { token: null, malformed: true };
  }

  return {
    token: match[1] ?? null,
    malformed: false,
  };
}

type VerifiedApiKey = NonNullable<
  Awaited<ReturnType<typeof verifyApiKey>>
>["key"];

/**
 * Rate-limits an API-key request (429 over the limit) and records that the
 * key was used. Session and MCP OAuth callers never come through here.
 */
async function admitApiKey(c: Context, keyId: string, ownerId: string) {
  await enforceApiKeyRateLimit(c, keyId);
  if (await keyOwnerMustSetUpTwoFactor(ownerId)) throw twoFactorRequiredError();
  void touchApiKeyLastUsed(keyId);
}

/**
 * Required two-factor: an account that still has to set it up gets no further
 * than the one route the setup screen reads.
 */
async function assertTwoFactorPolicy(
  c: Context,
  user: Parameters<typeof mustSetUpTwoFactor>[0],
) {
  if (c.req.method === "GET" && c.req.path === "/api/user/security") return;
  if (await mustSetUpTwoFactor(user)) throw twoFactorRequiredError();
}

async function useApiKey(c: Context, key: VerifiedApiKey) {
  await admitApiKey(c, key.id, key.userId);
  c.set("userId", key.userId);
  c.set("userEmail", "");
  c.set("user", null);
  c.set("session", null);
  c.set("apiKey", {
    id: key.id,
    userId: key.userId,
    enabled: key.enabled,
    permissions: key.permissions,
    projectIds: key.projectIds,
    readOnly: key.readOnly,
    // An agent run's key: who the agent acts for (ai-agent/attribution.ts).
    agentRun: key.metadata ? await resolveAgentVia(key) : null,
  });
  attachUserToScope(key.userId);
  // A read-only key never changes anything, whatever the route checks.
  if (key.readOnly && !readOnlyKeyAllows(c.req.method, c.req.path)) {
    throw new HTTPException(403, { message: "This API key is read-only" });
  }
}

export async function authenticateApiRequest(c: Context): Promise<void> {
  const { token, malformed } = parseBearerToken(c.req.header("Authorization"));
  if (malformed) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const apiKeyHeader = c.req.header("x-api-key")?.trim();
  if (!token && apiKeyHeader) {
    const apiKeyResult = await verifyApiKey(apiKeyHeader);
    if (!apiKeyResult?.valid || !apiKeyResult.key) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    await useApiKey(c, apiKeyResult.key);
    return;
  }

  if (token) {
    const apiKeyResult = await verifyApiKey(token);
    if (apiKeyResult?.valid && apiKeyResult.key) {
      await useApiKey(c, apiKeyResult.key);
      return;
    }
    const sessionResult = await getSessionFromBearerOnlyHeaders(c);
    if (sessionResult?.user && sessionResult.session) {
      await assertTwoFactorPolicy(c, sessionResult.user);
      c.set("user", sessionResult.user);
      c.set("session", sessionResult.session);
      c.set("userId", sessionResult.user.id);
      c.set("userEmail", sessionResult.user.email ?? "");
      attachUserToScope(sessionResult.user.id);
      return;
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const sessionResult = await getSession(c.req.raw.headers);
  c.set("user", sessionResult?.user ?? null);
  c.set("session", sessionResult?.session ?? null);
  c.set("userId", sessionResult?.user?.id ?? "");
  c.set("userEmail", sessionResult?.user?.email ?? "");

  if (!sessionResult?.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  await assertTwoFactorPolicy(c, sessionResult.user);
  attachUserToScope(sessionResult.user.id);
}

export async function resolveAssetBearerOrCookie(c: Context): Promise<{
  userId: string;
  apiKeyId?: string;
  keyPermissions?: Record<string, string[]> | null;
  keyProjectIds?: string[] | null;
}> {
  const { token, malformed } = parseBearerToken(c.req.header("Authorization"));
  if (malformed) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const apiKeyHeader = c.req.header("x-api-key")?.trim();
  if (!token && apiKeyHeader) {
    const apiKeyResult = await verifyApiKey(apiKeyHeader);
    if (apiKeyResult?.valid && apiKeyResult.key) {
      await admitApiKey(c, apiKeyResult.key.id, apiKeyResult.key.userId);
      return {
        userId: apiKeyResult.key.userId,
        apiKeyId: apiKeyResult.key.id,
        keyPermissions: apiKeyResult.key.permissions,
        keyProjectIds: apiKeyResult.key.projectIds,
      };
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  if (token) {
    const apiKeyResult = await verifyApiKey(token);
    if (apiKeyResult?.valid && apiKeyResult.key) {
      await admitApiKey(c, apiKeyResult.key.id, apiKeyResult.key.userId);
      return {
        userId: apiKeyResult.key.userId,
        apiKeyId: apiKeyResult.key.id,
        keyPermissions: apiKeyResult.key.permissions,
        keyProjectIds: apiKeyResult.key.projectIds,
      };
    }
    const sessionResult = await getSessionFromBearerOnlyHeaders(c);
    if (sessionResult?.user?.id) {
      await assertTwoFactorPolicy(c, sessionResult.user);
      return { userId: sessionResult.user.id };
    }
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const sessionResult = await getSession(c.req.raw.headers);
  if (!sessionResult?.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  await assertTwoFactorPolicy(c, sessionResult.user);
  return { userId: sessionResult.user.id };
}
