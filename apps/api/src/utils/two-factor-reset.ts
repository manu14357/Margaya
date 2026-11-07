import { and, eq, like } from "drizzle-orm";
import db from "../database";
import {
  pushSubscriptionTable,
  sessionTable,
  twoFactorTable,
  userTable,
  verificationTable,
} from "../database/schema";

/**
 * Clears an account's two-factor for someone who lost their authenticator and
 * recovery codes: the secret, the codes, its trusted devices (Better Auth
 * stores them as trust-device-* verification rows holding the user id; a kept
 * one would skip the challenge after the next set-up), every session and the
 * push devices that go with them. Returns false when two-factor wasn't on; a
 * half-finished set-up is still cleared, but the account stays signed in.
 */
export async function clearTwoFactor(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const turnedOff = await tx
      .update(userTable)
      .set({ twoFactorEnabled: false })
      .where(
        and(eq(userTable.id, userId), eq(userTable.twoFactorEnabled, true)),
      )
      .returning({ id: userTable.id });
    await tx.delete(twoFactorTable).where(eq(twoFactorTable.userId, userId));
    if (turnedOff.length === 0) return false;
    await tx
      .delete(verificationTable)
      .where(
        and(
          like(verificationTable.identifier, "trust-device-%"),
          eq(verificationTable.value, userId),
        ),
      );
    await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
    await tx
      .delete(pushSubscriptionTable)
      .where(eq(pushSubscriptionTable.userId, userId));
    return true;
  });
}
