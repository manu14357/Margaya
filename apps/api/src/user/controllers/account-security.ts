import { and, desc, eq, gt } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { accountTable, sessionTable, userTable } from "../../database/schema";
import { twoFactorApplies } from "../../utils/two-factor-policy";

/**
 * The signed-in user's password state and active sessions. Session tokens
 * never leave the server: a session is named by its id only.
 */
export async function getAccountSecurity(
  userId: string,
  currentSessionId: string,
) {
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

  const [user] = await db
    .select({
      twoFactorEnabled: userTable.twoFactorEnabled,
      role: userTable.role,
      isAnonymous: userTable.isAnonymous,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  const sessions = await db
    .select({
      id: sessionTable.id,
      userAgent: sessionTable.userAgent,
      ipAddress: sessionTable.ipAddress,
      createdAt: sessionTable.createdAt,
      updatedAt: sessionTable.updatedAt,
      expiresAt: sessionTable.expiresAt,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessionTable.updatedAt));

  return {
    hasPassword: Boolean(credential),
    twoFactorEnabled: user?.twoFactorEnabled === true,
    twoFactorRequired: user
      ? await twoFactorApplies({ id: userId, ...user })
      : false,
    sessions: sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.updatedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === currentSessionId,
    })),
  };
}

/** Signs out one of the user's other sessions. Unknown or foreign ids are 404. */
export async function revokeUserSession(
  userId: string,
  currentSessionId: string,
  sessionId: string,
) {
  if (sessionId === currentSessionId) {
    throw new HTTPException(400, {
      message: "Use sign out to end the current session",
    });
  }

  const deleted = await db
    .delete(sessionTable)
    .where(and(eq(sessionTable.id, sessionId), eq(sessionTable.userId, userId)))
    .returning({ id: sessionTable.id });

  if (deleted.length === 0) {
    throw new HTTPException(404, { message: "Session not found" });
  }

  return { revoked: true as const };
}
