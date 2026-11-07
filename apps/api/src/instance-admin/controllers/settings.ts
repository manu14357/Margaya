import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { SETTINGS_CATALOG } from "../../instance-settings/catalog";
import type { InstanceSettingsSnapshot } from "../../instance-settings/resolve";
import {
  getStoredSettingRows,
  refreshInstanceSettings,
} from "../../instance-settings/snapshot";
import { writeSettingChanges } from "../../instance-settings/store";
import { planSettingsPatch } from "../../instance-settings/validate";
import { enforceRateLimits } from "../../utils/rate-limit";
import {
  mustSetUpTwoFactor,
  signsInWithoutEmail,
} from "../../utils/two-factor-policy";
import { recordInstanceAudit } from "../audit";
import { settingsWriteLimiter } from "../limits";

/** The A2 shape. Secret values never leave the server. */
export function serializeInstanceSettings(snapshot: InstanceSettingsSnapshot) {
  const settings = SETTINGS_CATALOG.map((entry) => {
    const resolved = snapshot.settings[entry.key];
    if (!resolved) throw new Error(`Unresolved setting ${entry.key}`);
    return {
      key: resolved.key,
      group: resolved.group,
      ...(resolved.secret ? {} : { value: resolved.value }),
      source: resolved.source,
      locked: resolved.locked,
      envVar: resolved.envVar,
      secret: resolved.secret,
      configured: resolved.configured,
      unreadable: resolved.unreadable,
      updatedAt: resolved.updatedAt,
      updatedBy: resolved.updatedBy,
    };
  });
  const { derived } = snapshot;
  return {
    locked: snapshot.locked,
    settings,
    derived: {
      smtpConfigured: derived.smtpConfigured,
      guestAccessActive: derived.guestAccessActive,
      emailCodeActive: derived.emailCodeActive,
      signInMethodsActive: derived.signInMethodsActive,
      providers: derived.providers,
    },
  };
}

export async function getInstanceSettingsView() {
  return serializeInstanceSettings(await refreshInstanceSettings());
}

export async function updateInstanceSettings(
  values: Record<string, unknown>,
  userId: string,
) {
  await enforceRateLimits([[settingsWriteLimiter, userId]]);
  const current = await refreshInstanceSettings();
  const plan = planSettingsPatch({
    env: process.env,
    current,
    rows: getStoredSettingRows(),
    values,
  });
  if (!plan.ok) {
    throw new HTTPException(plan.status, { message: plan.message });
  }
  if (plan.changes.length === 0) return serializeInstanceSettings(current);

  // Whoever turns the requirement on would be sent to set it up straight away,
  // with this panel out of reach until they had. And it turns email links and
  // codes off: an admin who has nothing else couldn't sign in again.
  const { candidate } = plan;
  if (
    candidate.effective.requireTwoFactor &&
    !current.effective.requireTwoFactor
  ) {
    const [caller] = await db
      .select({
        role: userTable.role,
        twoFactorEnabled: userTable.twoFactorEnabled,
        isAnonymous: userTable.isAnonymous,
      })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (
      caller &&
      (await mustSetUpTwoFactor({ id: userId, ...caller }, candidate.effective))
    ) {
      throw new HTTPException(409, {
        message:
          "Turn on two-factor for your own account before requiring it for everyone",
      });
    }
    if (
      candidate.effective.emailSignIn &&
      !(await signsInWithoutEmail(userId, candidate.derived))
    ) {
      throw new HTTPException(409, {
        message:
          "Set a password for your own account before requiring two-factor: email links and codes turn off, and you'd have no other way to sign in",
      });
    }
  }

  await writeSettingChanges(plan.changes, userId);
  // Listeners rebuild on the next read: the auth facade compares its OAuth
  // fingerprint and the email transport its options.
  const next = await refreshInstanceSettings();
  const keys = plan.changes.map((change) => change.key);
  console.info("Instance settings updated", { keys, userId });
  await publishEvent("instance.settings_updated", { keys, userId });
  // Keys only: values may be secrets (SMTP password, OAuth client secrets).
  await recordInstanceAudit({
    action: "instance.settings_updated",
    target: { type: "settings", label: keys.join(", ") },
    metadata: { keys },
    actor: { userId },
  });
  return serializeInstanceSettings(next);
}
