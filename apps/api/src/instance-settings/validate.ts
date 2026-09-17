import type { Env, SettingValue } from "./catalog";
import { LOCK_VARIABLE, settingDefinition } from "./catalog";
import {
  type InstanceSettingsSnapshot,
  resolveInstanceSettings,
  type StoredSetting,
} from "./resolve";
import type { SettingChange } from "./store";

// Pure rules for a settings PATCH (B12 §3.17): lock, unknown keys, per-key
// validation, no-op detection and the cross-field lockout guard.

export type PatchRejection = { ok: false; status: 400 | 409; message: string };
export type PatchPlan = {
  ok: true;
  /** Changes that differ from what is stored. Empty for a no-op. */
  changes: SettingChange[];
  candidate: InstanceSettingsSnapshot;
};

function reject(status: 400 | 409, message: string): PatchRejection {
  return { ok: false, status, message };
}

/** Applies changes to stored rows (for the candidate snapshot). */
export function applyChanges(
  rows: readonly StoredSetting[],
  changes: readonly SettingChange[],
  now = new Date(),
): StoredSetting[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const change of changes) {
    if (change.value === null) {
      byKey.delete(change.key);
      continue;
    }
    byKey.set(change.key, {
      key: change.key,
      value: change.value,
      unreadable: false,
      updatedAt: now,
      updatedBy: null,
    });
  }
  return [...byKey.values()];
}

function isNoOp(row: StoredSetting | undefined, value: SettingValue | null) {
  if (value === null) return row === undefined;
  return row !== undefined && !row.unreadable && row.value === value;
}

export function planSettingsPatch(input: {
  env: Env;
  current: InstanceSettingsSnapshot;
  rows: readonly StoredSetting[];
  values: Record<string, unknown>;
}): PatchPlan | PatchRejection {
  const { env, current, rows, values } = input;
  if (current.locked) {
    return reject(
      409,
      "Instance settings are managed with environment variables on this server",
    );
  }

  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  const changes: SettingChange[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const entry = settingDefinition(key);
    if (!entry) return reject(400, `Unknown setting: ${key}`);

    const resolved = current.settings[key];
    if (resolved?.locked) {
      return reject(
        409,
        `${key} is set by ${resolved.envVar ?? LOCK_VARIABLE}. Remove the variable and restart to manage it here.`,
      );
    }

    let value: SettingValue | null = null;
    if (raw !== null) {
      if (entry.secret && typeof raw === "string" && raw.trim() === "") {
        return reject(400, `Use null to clear ${key}`);
      }
      const parsed = entry.schema.safeParse(raw);
      if (!parsed.success) {
        const reason = parsed.error.issues[0]?.message ?? "invalid value";
        return reject(400, `Invalid value for ${key}: ${reason}`);
      }
      value = parsed.data;
    }
    if (!isNoOp(rowsByKey.get(key), value)) changes.push({ key, value });
  }

  const candidate = resolveInstanceSettings({
    env,
    rows: applyChanges(rows, changes),
  });
  // Only a change that removes the last working sign-in method is refused, so
  // an instance already at zero (by environment) can still save other keys.
  const before = current.derived.signInMethodsActive;
  const after = candidate.derived.signInMethodsActive;
  if (after < 1 && after < before) {
    return reject(409, "Keep at least one way to sign in");
  }

  return { ok: true, changes, candidate };
}
