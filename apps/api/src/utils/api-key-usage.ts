import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import db, { schema } from "../database";

// Margaya verifies API keys itself (utils/verify-api-key.ts), which skips
// Better Auth's bookkeeping, so "last used" is recorded here. Writes are
// throttled twice: this instance skips keys it touched in the last minute,
// and the SQL only updates rows older than a minute (other instances).
export const LAST_USED_THROTTLE_MS = 60_000;

const lastWrites = new Map<string, number>();

// The column is a timestamp without time zone holding UTC (as Better Auth
// writes it), so "now" is taken in UTC whatever the session time zone is.
const utcNow = sql`(now() at time zone 'utc')`;

function pruneLastWrites(now: number) {
  for (const [keyId, at] of lastWrites) {
    if (now - at >= LAST_USED_THROTTLE_MS) lastWrites.delete(keyId);
  }
}

/** Records that a key was used. Never throws; never logs the key itself. */
export async function touchApiKeyLastUsed(
  keyId: string,
  now: number = Date.now(),
): Promise<void> {
  const previous = lastWrites.get(keyId);
  if (previous !== undefined && now - previous < LAST_USED_THROTTLE_MS) return;
  if (lastWrites.size > 10_000) pruneLastWrites(now);
  lastWrites.set(keyId, now);

  try {
    await db
      .update(schema.apikeyTable)
      .set({ lastRequest: utcNow })
      .where(
        and(
          eq(schema.apikeyTable.id, keyId),
          or(
            isNull(schema.apikeyTable.lastRequest),
            lt(
              schema.apikeyTable.lastRequest,
              sql`${utcNow} - interval '60 seconds'`,
            ),
          ),
        ),
      );
  } catch (error) {
    console.error("Failed to record API key usage", {
      keyId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Test hook: forget this instance's throttle state. */
export function resetApiKeyUsageThrottle() {
  lastWrites.clear();
}
