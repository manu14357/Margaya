import { HTTPException } from "hono/http-exception";
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
