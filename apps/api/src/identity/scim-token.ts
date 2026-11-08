import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import db from "../database";
import { scimProviderTable } from "../database/schema";

// A SCIM token is `base64url(secret:providerId:workspaceId)`, the format Better
// Auth's SCIM plugin reads. Only the secret's hash is stored, so a token can be
// shown once and never again, and a database leak gives nobody a usable token.

export function hashScimSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

export function newScimCredentials(providerId: string, workspaceId: string) {
  const secret = randomBytes(32).toString("base64url");
  return {
    token: Buffer.from(`${secret}:${providerId}:${workspaceId}`).toString(
      "base64url",
    ),
    storedHash: hashScimSecret(secret),
  };
}

export function parseScimToken(authorization: string | null | undefined) {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const [secret, providerId, ...workspace] = Buffer.from(token, "base64url")
    .toString("utf8")
    .split(":");
  const workspaceId = workspace.join(":");
  return secret && providerId && workspaceId
    ? { secret, providerId, workspaceId }
    : null;
}

/** The connection a request's token belongs to, or null for any bad token. */
export async function findScimConnection(
  authorization: string | null | undefined,
) {
  const parsed = parseScimToken(authorization);
  if (!parsed) return null;
  const [connection] = await db
    .select()
    .from(scimProviderTable)
    .where(
      and(
        eq(scimProviderTable.providerId, parsed.providerId),
        eq(scimProviderTable.organizationId, parsed.workspaceId),
      ),
    )
    .limit(1);
  if (!connection) return null;
  const expected = Buffer.from(connection.scimToken);
  const actual = Buffer.from(hashScimSecret(parsed.secret));
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? connection
    : null;
}
