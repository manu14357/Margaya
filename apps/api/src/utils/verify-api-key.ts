import { createHash } from "node:crypto";
import { and, eq, exists, gt, isNull, or, sql } from "drizzle-orm";
import { decodeScope } from "../api-key/scope";
import db, { schema } from "../database";

async function hashApiKey(key: string): Promise<string> {
  const hash = createHash("sha256").update(key).digest();
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function parsePermissions(raw: string | null): Record<string, string[]> | null {
  if (raw === null) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const permissions: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!Array.isArray(actions)) return {};
    if (actions.some((action) => typeof action !== "string")) return {};
    permissions[resource] = actions as string[];
  }
  return permissions;
}

export async function verifyApiKey(key: string) {
  const hashedKey = await hashApiKey(key);

  const [apiKey] = await db
    .select()
    .from(schema.apikeyTable)
    .where(
      and(
        eq(schema.apikeyTable.key, hashedKey),
        eq(schema.apikeyTable.enabled, true),
        // Fail closed even before legacy databases finish the repair migration.
        exists(
          db
            .select({ id: schema.userTable.id })
            .from(schema.userTable)
            .where(
              and(
                eq(
                  schema.userTable.id,
                  sql`coalesce(${schema.apikeyTable.referenceId}, ${schema.apikeyTable.userId})`,
                ),
                // A banned owner's keys stop working until the ban ends.
                sql`(${schema.userTable.banned} is not true or (${schema.userTable.banExpires} is not null and ${schema.userTable.banExpires} <= now()))`,
              ),
            ),
        ),
        or(
          isNull(schema.apikeyTable.expiresAt),
          gt(schema.apikeyTable.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);

  if (!apiKey) {
    return null;
  }

  const scope = decodeScope(parsePermissions(apiKey.permissions));

  return {
    valid: true,
    key: {
      id: apiKey.id,
      userId: apiKey.referenceId ?? apiKey.userId ?? "",
      name: apiKey.name,
      prefix: apiKey.prefix,
      start: apiKey.start,
      enabled: apiKey.enabled ?? false,
      expiresAt: apiKey.expiresAt,
      // Statements only; the scope markers are split out (api-key/scope.ts).
      permissions: scope.permissions,
      projectIds: scope.projectIds,
      readOnly: scope.readOnly,
      scoped: apiKey.permissions !== null,
      refillInterval: apiKey.refillInterval,
      refillAmount: apiKey.refillAmount,
      lastRefillAt: apiKey.lastRefillAt,
      rateLimitEnabled: apiKey.rateLimitEnabled,
      rateLimitTimeWindow: apiKey.rateLimitTimeWindow,
      rateLimitMax: apiKey.rateLimitMax,
      requestCount: apiKey.requestCount,
      remaining: apiKey.remaining,
      lastRequest: apiKey.lastRequest,
      metadata: apiKey.metadata
        ? (JSON.parse(apiKey.metadata) as Record<string, unknown>)
        : null,
    },
  };
}
