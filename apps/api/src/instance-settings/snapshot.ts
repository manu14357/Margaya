import { setSmtpConfigProvider } from "@margaya/email";
import { RESOLVER_ENV_VARIABLES } from "./catalog";
import { smtpConfigOf } from "./effective-config";
import {
  type InstanceSettingsSnapshot,
  resolveInstanceSettings,
  type StoredSetting,
} from "./resolve";
import { loadSettingRows } from "./store";

// One effective snapshot per API process (B12 K26). Rows load at startup,
// every 10 seconds, and right after a local write; other instances converge
// within 10 seconds without Redis. Readers call `getInstanceSettings()`
// synchronously. Environment variables are read on every call (memoized over
// their values), so before the first load the snapshot is exactly today's
// environment-only behavior.

const REFRESH_INTERVAL_MS = 10_000;

let rows: readonly StoredSetting[] = [];
let rowsVersion = 0;
let memo: {
  envKey: string;
  rowsVersion: number;
  snapshot: InstanceSettingsSnapshot;
} | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const warnedInvalid = new Set<string>();

function currentEnvKey(): string {
  let key = "";
  for (const name of RESOLVER_ENV_VARIABLES) {
    key += `${process.env[name] ?? "\u0000"}\u0001`;
  }
  return key;
}

function warnInvalid(key: string, reason: string) {
  if (warnedInvalid.has(key)) return;
  warnedInvalid.add(key);
  console.warn(
    `Ignoring the saved value of instance setting ${key}: ${reason}`,
  );
}

/** The effective settings now. Always returns a snapshot; never throws. */
export function getInstanceSettings(): InstanceSettingsSnapshot {
  const envKey = currentEnvKey();
  if (memo && memo.envKey === envKey && memo.rowsVersion === rowsVersion) {
    return memo.snapshot;
  }
  const snapshot = resolveInstanceSettings({
    env: process.env,
    rows,
    warn: warnInvalid,
  });
  memo = { envKey, rowsVersion, snapshot };
  return snapshot;
}

/** The stored rows behind the current snapshot (secrets decrypted). */
export function getStoredSettingRows(): readonly StoredSetting[] {
  return rows;
}

/** Reloads the rows; readers see the new snapshot at once. */
export async function refreshInstanceSettings(): Promise<InstanceSettingsSnapshot> {
  rows = await loadSettingRows();
  rowsVersion += 1;
  return getInstanceSettings();
}

/** Startup: install the email provider, load the rows, start the refresh. */
export async function initializeInstanceSettings(): Promise<void> {
  setSmtpConfigProvider(() => smtpConfigOf(getInstanceSettings()));
  try {
    await refreshInstanceSettings();
  } catch (error) {
    console.error("Couldn't load instance settings; using the environment", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!timer) {
    timer = setInterval(() => {
      refreshInstanceSettings().catch((error) => {
        console.error("Instance settings refresh failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, REFRESH_INTERVAL_MS);
    timer.unref?.();
  }
}

export function stopInstanceSettings(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
