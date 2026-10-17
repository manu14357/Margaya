import { and, asc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  INSTANCE_ADMIN_LOCK_ID,
  isLastInstanceAdmin,
} from "../../utils/instance-admins";
import { nonAnonymousUser } from "../../utils/instance-bootstrap";
import { enforceRateLimits } from "../../utils/rate-limit";
import { recordInstanceAudit, userTargetLabel } from "../audit";
import { settingsWriteLimiter } from "../limits";

const LAST_ADMIN = "There must be at least one instance admin";

const adminColumns = {
  id: userTable.id,
  name: userTable.name,
  email: userTable.email,
  image: userTable.image,
};

type AdminRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

function view(row: AdminRow, callerId: string) {
  return { ...row, isYou: row.id === callerId };
}

/** A6: every instance admin (guests can never be one). */
export async function listInstanceAdmins(callerId: string) {
  const rows = await db
    .select(adminColumns)
    .from(userTable)
    .where(and(eq(userTable.role, "admin"), nonAnonymousUser))
    .orderBy(asc(userTable.name), asc(userTable.id));
  return rows.map((row) => view(row, callerId));
}

function isBanned(row: { banned: boolean | null; banExpires: Date | null }) {
  return (
    row.banned === true &&
    (row.banExpires === null || row.banExpires.getTime() > Date.now())
  );
}

/** A7: promote an existing account by email. */
export async function addInstanceAdmin(email: string, callerId: string) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INSTANCE_ADMIN_LOCK_ID})`,
    );
    const [target] = await tx
      .select({
        ...adminColumns,
        role: userTable.role,
        isAnonymous: userTable.isAnonymous,
        banned: userTable.banned,
        banExpires: userTable.banExpires,
      })
      .from(userTable)
      .where(sql`lower(${userTable.email}) = ${email.trim().toLowerCase()}`)
      .limit(1);
    if (!target) {
      throw new HTTPException(404, { message: "No account uses this email" });
    }
    if (target.isAnonymous) {
      throw new HTTPException(400, {
        message: "Guest accounts can't be instance admins",
      });
    }
    if (isBanned(target)) {
      throw new HTTPException(400, { message: "This account is banned" });
    }
    const changed = target.role !== "admin";
    if (changed) {
      await tx
        .update(userTable)
        .set({ role: "admin" })
        .where(eq(userTable.id, target.id));
    }
    return { target, changed };
  });

  if (result.changed) {
    await publishEvent("instance.admin_added", {
      targetUserId: result.target.id,
      userId: callerId,
    });
    await recordInstanceAudit({
      action: "instance.admin_added",
      target: {
        type: "user",
        id: result.target.id,
        label: result.target.email,
      },
      actor: { userId: callerId },
    });
  }
  const { id, name, email: address, image } = result.target;
  return view({ id, name, email: address, image }, callerId);
}

/** A8: demote an admin, never the last active one. */
export async function removeInstanceAdmin(userId: string, callerId: string) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INSTANCE_ADMIN_LOCK_ID})`,
    );
    const [target] = await tx
      .select({ role: userTable.role })
      .from(userTable)
      .where(and(eq(userTable.id, userId), nonAnonymousUser))
      .limit(1);
    if (target?.role !== "admin") {
      throw new HTTPException(404, {
        message: "This person isn't an instance admin",
      });
    }
    if (await isLastInstanceAdmin(userId, tx)) {
      throw new HTTPException(409, { message: LAST_ADMIN });
    }
    await tx
      .update(userTable)
      .set({ role: "user" })
      .where(eq(userTable.id, userId));
  });

  await publishEvent("instance.admin_removed", {
    targetUserId: userId,
    userId: callerId,
  });
  await recordInstanceAudit({
    action: "instance.admin_removed",
    target: { type: "user", id: userId, label: await userTargetLabel(userId) },
    actor: { userId: callerId },
  });
  return { userId };
}
