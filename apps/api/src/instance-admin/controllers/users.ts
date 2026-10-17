import bcrypt from "bcryptjs";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { auth } from "../../auth";
import db from "../../database";
import {
  accountTable,
  sessionTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import { getInstanceSettings } from "../../instance-settings/snapshot";
import {
  afterKeyset,
  decodeKeyset,
  encodeKeyset,
  timeKey,
} from "../../publication/keyset";
import {
  INSTANCE_ADMIN_LOCK_ID,
  isLastInstanceAdmin,
} from "../../utils/instance-admins";
import { nonAnonymousUser } from "../../utils/instance-bootstrap";
import { checkNewPassword } from "../../utils/password-policy";
import { enforceRateLimits } from "../../utils/rate-limit";
import { recordInstanceAudit } from "../audit";
import { settingsWriteLimiter } from "../limits";

// Instance user management (4.12): list and search accounts, see their
// workspaces, ban and unban, reset a password, sign out everywhere. Admin
// promotion and demotion stay on the /admins routes. Every change needs the
// recent sign-in (reauth.ts) and lands in the instance audit trail.

type PageQuery = {
  search?: string;
  status?: "all" | "admins" | "banned";
  cursor?: string;
  limit: number;
};

function likePattern(search: string) {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** Banned now: the flag is set and the ban has not run out. */
const bannedNow = sql<boolean>`(${userTable.banned} is true and (${userTable.banExpires} is null or ${userTable.banExpires} > now()))`;

/** Every account except guests, newest first. */
export async function listInstanceUsers({
  search,
  status = "all",
  cursor,
  limit,
}: PageQuery) {
  const conditions: (SQL | undefined)[] = [nonAnonymousUser];
  if (search) {
    const pattern = likePattern(search);
    conditions.push(
      or(ilike(userTable.name, pattern), ilike(userTable.email, pattern)),
    );
  }
  if (status === "admins") conditions.push(eq(userTable.role, "admin"));
  if (status === "banned") conditions.push(bannedNow);
  if (cursor) {
    conditions.push(
      afterKeyset(
        userTable.createdAt,
        userTable.id,
        decodeKeyset(cursor),
        "desc",
      ),
    );
  }

  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      role: userTable.role,
      banned: bannedNow,
      banReason: userTable.banReason,
      banExpires: userTable.banExpires,
      twoFactorEnabled: userTable.twoFactorEnabled,
      createdAt: userTable.createdAt,
      at: timeKey(userTable.createdAt),
      workspaceCount: sql<number>`(select count(*) from "workspace_member" wm where wm."user_id" = "user"."id")`,
      lastActiveAt:
        sql<Date | null>`(select max(s."updated_at") from "session" s where s."user_id" = "user"."id")`.mapWith(
          userTable.createdAt,
        ),
    })
    .from(userTable)
    .where(and(...conditions))
    .orderBy(desc(userTable.createdAt), desc(userTable.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ at: _at, ...row }) => ({
      ...row,
      isAdmin: row.role === "admin",
      banned: Boolean(row.banned),
      twoFactorEnabled: row.twoFactorEnabled === true,
      workspaceCount: Number(row.workspaceCount),
    })),
    nextCursor:
      rows.length > limit && last ? encodeKeyset(last.at, last.id) : null,
  };
}

async function findUser(userId: string) {
  const [user] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      role: userTable.role,
      banned: bannedNow,
    })
    .from(userTable)
    .where(and(eq(userTable.id, userId), nonAnonymousUser))
    .limit(1);
  if (!user) throw new HTTPException(404, { message: "User not found" });
  return user;
}

/** One account's workspaces and sign-in state. */
export async function getInstanceUser(userId: string) {
  const user = await findUser(userId);
  const workspaces = await db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      slug: workspaceTable.slug,
      role: workspaceUserTable.role,
      joinedAt: workspaceUserTable.joinedAt,
    })
    .from(workspaceUserTable)
    .innerJoin(
      workspaceTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .where(eq(workspaceUserTable.userId, userId))
    .orderBy(asc(workspaceTable.name), asc(workspaceTable.id));
  const [sessions] = await db
    .select({ value: count() })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    );
  const [credential] = await db
    .select({ id: accountTable.id })
    .from(accountTable)
    .where(
      and(
        eq(accountTable.userId, userId),
        eq(accountTable.providerId, "credential"),
      ),
    )
    .limit(1);
  return {
    id: user.id,
    workspaces,
    activeSessions: Number(sessions?.value ?? 0),
    hasPassword: Boolean(credential),
  };
}

function assertNotSelf(userId: string, callerId: string, action: string) {
  if (userId === callerId) {
    throw new HTTPException(400, { message: `You can't ${action} yourself` });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bans an account and signs it out everywhere. Never the last admin. */
export async function banInstanceUser(
  userId: string,
  callerId: string,
  input: { reason?: string; expiresInDays?: number | null },
) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  assertNotSelf(userId, callerId, "ban");
  const target = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${INSTANCE_ADMIN_LOCK_ID})`,
    );
    const user = await findUser(userId);
    if (user.role === "admin" && (await isLastInstanceAdmin(userId, tx))) {
      throw new HTTPException(409, {
        message: "There must be at least one instance admin",
      });
    }
    await tx
      .update(userTable)
      .set({
        banned: true,
        banReason: input.reason?.trim() || null,
        banExpires: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * DAY_MS)
          : null,
      })
      .where(eq(userTable.id, userId));
    await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
    return user;
  });
  await recordInstanceAudit({
    action: "user.banned",
    target: { type: "user", id: userId, label: target.email },
    metadata: {
      reason: input.reason?.trim() || null,
      expiresInDays: input.expiresInDays ?? null,
    },
    actor: { userId: callerId },
  });
  return { userId, banned: true };
}

export async function unbanInstanceUser(userId: string, callerId: string) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const user = await findUser(userId);
  await db
    .update(userTable)
    .set({ banned: false, banReason: null, banExpires: null })
    .where(eq(userTable.id, userId));
  await recordInstanceAudit({
    action: "user.unbanned",
    target: { type: "user", id: userId, label: user.email },
    actor: { userId: callerId },
  });
  return { userId, banned: false };
}

/** Signs an account out of every session (devices, browsers, the CLI). */
export async function revokeInstanceUserSessions(
  userId: string,
  callerId: string,
) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  assertNotSelf(userId, callerId, "sign out");
  const user = await findUser(userId);
  const removed = await db
    .delete(sessionTable)
    .where(eq(sessionTable.userId, userId))
    .returning({ id: sessionTable.id });
  await recordInstanceAudit({
    action: "user.sessions_revoked",
    target: { type: "user", id: userId, label: user.email },
    metadata: { sessions: removed.length },
    actor: { userId: callerId },
  });
  return { userId, revoked: removed.length };
}

/**
 * Resets a password: with a new password, sets it and signs the account out
 * everywhere; without one, emails the account a reset link (needs SMTP).
 */
export async function resetInstanceUserPassword(
  userId: string,
  callerId: string,
  input: { password?: string },
) {
  await enforceRateLimits([[settingsWriteLimiter, callerId]]);
  const user = await findUser(userId);

  if (!input.password) {
    if (!getInstanceSettings().derived.smtpConfigured) {
      throw new HTTPException(409, {
        message:
          "Email is not set up. Set a new password instead, or use the recovery CLI.",
      });
    }
    const clientUrl = (
      process.env.MARGAYA_CLIENT_URL || "http://localhost:5173"
    ).replace(/\/$/, "");
    await auth.api.requestPasswordReset({
      body: {
        email: user.email,
        redirectTo: `${clientUrl}/auth/reset-password`,
      },
    });
    await recordInstanceAudit({
      action: "user.password_reset_sent",
      target: { type: "user", id: userId, label: user.email },
      actor: { userId: callerId },
    });
    return { userId, method: "email" as const };
  }

  const violation = checkNewPassword(input.password, { email: user.email });
  if (violation) {
    throw new HTTPException(400, { message: violation.message });
  }
  const hash = await bcrypt.hash(input.password, 10);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(accountTable)
      .set({ password: hash, updatedAt: new Date() })
      .where(
        and(
          eq(accountTable.userId, userId),
          eq(accountTable.providerId, "credential"),
        ),
      )
      .returning({ id: accountTable.id });
    if (updated.length === 0) {
      await tx.insert(accountTable).values({
        accountId: userId,
        providerId: "credential",
        userId,
        password: hash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
  });
  await recordInstanceAudit({
    action: "user.password_set",
    target: { type: "user", id: userId, label: user.email },
    actor: { userId: callerId },
  });
  return { userId, method: "set" as const };
}
