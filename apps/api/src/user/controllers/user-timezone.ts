import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable } from "../../database/schema";
import { isValidTimezone, normalizeTimezone } from "../../utils/timezone";

export const INVALID_TIMEZONE = "Unknown time zone";

/** The stored zone, null when the user never chose one (UTC applies). */
export async function getUserTimezoneSetting(userId: string) {
  const [row] = await db
    .select({ timezone: userTable.timezone })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "User not found" });
  const timezone =
    row.timezone && isValidTimezone(row.timezone) ? row.timezone : null;
  return { timezone };
}

export async function setUserTimezone(userId: string, timezone: string | null) {
  if (timezone !== null && !isValidTimezone(timezone)) {
    throw new HTTPException(400, { message: INVALID_TIMEZONE });
  }
  const next = timezone === null ? null : normalizeTimezone(timezone);
  await db
    .update(userTable)
    .set({ timezone: next })
    .where(eq(userTable.id, userId));
  return { timezone: next };
}
