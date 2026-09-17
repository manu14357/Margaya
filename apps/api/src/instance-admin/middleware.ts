import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { userTable } from "../database/schema";

/**
 * Instance admins only (B12 K22). Runs after `requireUserSession`, so API keys
 * never get here, and re-reads the role from the database instead of trusting
 * the session's copy.
 */
export async function requireInstanceAdmin(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  const [row] = userId
    ? await db
        .select({ role: userTable.role, banned: userTable.banned })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1)
    : [];
  if (row?.role !== "admin" || row.banned === true) {
    throw new HTTPException(403, {
      message: "Only instance admins can do this",
    });
  }
  return next();
}
