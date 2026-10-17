import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { accountTable, verificationTable } from "../database/schema";
import { enforceRateLimits } from "../utils/rate-limit";
import { recordInstanceAudit } from "./audit";
import { reauthLimiter } from "./limits";

// Instance-admin changes need a recent sign-in: a session opened within the
// window, or a password confirmed within it. The confirmation is stored per
// session in Better Auth's verification table, so it holds across API
// instances and ends with the session. Admins without a password (social,
// OIDC, email codes) confirm by signing in again.

export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
export const REAUTH_REQUIRED = "REAUTH_REQUIRED";

const IDENTIFIER_PREFIX = "instance-admin-reauth:";

type SessionLike = { id: string; createdAt: Date | string };

function identifier(sessionId: string) {
  return `${IDENTIFIER_PREFIX}${sessionId}`;
}

/** Whether the session was opened, or its password confirmed, recently. */
export async function hasRecentAuth(
  session: SessionLike,
  now = Date.now(),
): Promise<boolean> {
  const openedAt = new Date(session.createdAt).getTime();
  if (Number.isFinite(openedAt) && now - openedAt < REAUTH_WINDOW_MS) {
    return true;
  }
  const [row] = await db
    .select({ id: verificationTable.id })
    .from(verificationTable)
    .where(
      and(
        eq(verificationTable.identifier, identifier(session.id)),
        gt(verificationTable.expiresAt, new Date(now)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const reauthRequiredBody = {
  code: REAUTH_REQUIRED,
  message:
    "Confirm it's you: enter your password or sign in again to change instance settings.",
};

function reauthRequired(): HTTPException {
  return new HTTPException(403, {
    res: new Response(JSON.stringify(reauthRequiredBody), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  });
}

/** Route middleware; runs after requireUserSession and requireInstanceAdmin. */
export async function requireRecentAuth(c: Context, next: Next) {
  const session = c.get("session") as SessionLike | null | undefined;
  if (!session || !(await hasRecentAuth(session))) throw reauthRequired();
  return next();
}

/**
 * Confirms the caller's password and opens the window for this session.
 * Five attempts a minute per admin.
 */
export async function confirmAdminPassword({
  userId,
  sessionId,
  password,
}: {
  userId: string;
  sessionId: string;
  password: string;
}) {
  await enforceRateLimits([[reauthLimiter, userId]]);
  const [credential] = await db
    .select({ password: accountTable.password })
    .from(accountTable)
    .where(
      and(
        eq(accountTable.userId, userId),
        eq(accountTable.providerId, "credential"),
      ),
    )
    .limit(1);
  if (!credential?.password) {
    throw new HTTPException(400, {
      message: "This account has no password. Sign in again instead.",
    });
  }
  if (!(await bcrypt.compare(password, credential.password))) {
    throw new HTTPException(403, {
      res: new Response(
        JSON.stringify({
          code: "INVALID_PASSWORD",
          message: "That password isn't right.",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    });
  }

  const expiresAt = new Date(Date.now() + REAUTH_WINDOW_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(verificationTable)
      .where(eq(verificationTable.identifier, identifier(sessionId)));
    await tx.insert(verificationTable).values({
      identifier: identifier(sessionId),
      value: userId,
      expiresAt,
    });
  });
  await recordInstanceAudit({ action: "instance.reauthenticated" });
  return { reauthenticatedUntil: expiresAt.toISOString() };
}
