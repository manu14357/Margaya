import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { nonAnonymousUser } from "./instance-bootstrap";

// The same advisory lock `promoteInitialAdministrator` takes, so admin
// changes and the first-admin election never interleave.
export const INSTANCE_ADMIN_LOCK_ID = 2026;

/** Admins that can still sign in: role admin, not a guest, not banned. */
export const activeInstanceAdmin = and(
  eq(schema.userTable.role, "admin"),
  nonAnonymousUser,
  sql`${schema.userTable.banned} IS NOT TRUE`,
);

type Executor = Pick<typeof db, "select">;

/** Whether `userId` is the only active instance admin. */
export async function isLastInstanceAdmin(
  userId: string,
  executor: Executor = db,
): Promise<boolean> {
  const admins = await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(activeInstanceAdmin)
    .limit(2);
  return admins.length === 1 && admins[0]?.id === userId;
}
