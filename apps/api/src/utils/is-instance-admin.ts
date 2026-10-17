import { eq } from "drizzle-orm";
import type { Context } from "hono";
import db from "../database";
import { userTable } from "../database/schema";
import { instanceAdminApiKeysAllowed } from "./admin-api-keys";

/**
 * Whether the caller may use instance-admin reach. An API key may not,
 * unless ALLOW_INSTANCE_ADMIN_API_KEYS=true (see admin-api-keys.ts).
 */
export async function isInstanceAdmin(c: Context): Promise<boolean> {
  if (c.get("apiKey") && !instanceAdminApiKeysAllowed()) return false;
  const user = c.get("user") as { role?: string | null } | null | undefined;
  if (user?.role) {
    return user.role === "admin";
  }

  const userId = c.get("userId");
  if (!userId) return false;

  const [row] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  return row?.role === "admin";
}
