import type { UserPreferencesPatch } from "@/fetchers/user/update-user-preferences";
import {
  SCHEDULE_VIEW_DEFAULTS,
  useScheduleViewPreferences,
} from "@/store/schedule-view-preferences";
import {
  DEFAULT_USER_PREFERENCES,
  useUserPreferencesStore,
} from "@/store/user-preferences";

// The per-user preferences the server keeps (GET/PATCH /user/preferences).
// Local storage stays the instant cache and the signed-out fallback.

export type SyncedPreferences = UserPreferencesPatch;
export type SyncedKey = keyof SyncedPreferences;

const MAIN_DEFAULTS = DEFAULT_USER_PREFERENCES;
const SCHEDULE_DEFAULTS = SCHEDULE_VIEW_DEFAULTS;

export const MAIN_KEYS = Object.keys(
  MAIN_DEFAULTS,
) as (keyof typeof MAIN_DEFAULTS & SyncedKey)[];
export const SCHEDULE_KEYS = Object.keys(
  SCHEDULE_DEFAULTS,
) as (keyof typeof SCHEDULE_DEFAULTS & SyncedKey)[];

const DEFAULTS: Record<string, unknown> = {
  ...MAIN_DEFAULTS,
  ...SCHEDULE_DEFAULTS,
};

function pick(
  state: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = state[key];
  return out;
}

/** The synced values both stores hold right now. */
export function currentPreferences(): SyncedPreferences {
  return {
    ...pick(useUserPreferencesStore.getState(), MAIN_KEYS),
    ...pick(useScheduleViewPreferences.getState(), SCHEDULE_KEYS),
  } as SyncedPreferences;
}

/** The synced keys whose value differs between two snapshots. */
export function changedPreferences(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
): SyncedPreferences {
  const changed: Record<string, unknown> = {};
  for (const key of keys) {
    if (before[key] !== after[key]) changed[key] = after[key];
  }
  return changed as SyncedPreferences;
}

/**
 * The values a user chose away from the defaults. Seeding the server with
 * only these keeps future default changes (and the light theme for anyone
 * who never picked one) in effect.
 */
export function chosenPreferences(
  values: SyncedPreferences,
): SyncedPreferences {
  const chosen: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== DEFAULTS[key]) chosen[key] = value;
  }
  return chosen as SyncedPreferences;
}

/**
 * Writes server values into the stores, except keys with a local change
 * still on its way to the server: the newer local choice wins.
 */
export function applyServerPreferences(
  server: SyncedPreferences,
  pendingKeys: ReadonlySet<string>,
) {
  const main: Record<string, unknown> = {};
  const schedule: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(server)) {
    if (value === undefined || pendingKeys.has(key)) continue;
    if ((MAIN_KEYS as readonly string[]).includes(key)) main[key] = value;
    else if ((SCHEDULE_KEYS as readonly string[]).includes(key)) {
      schedule[key] = value;
    }
  }
  const mainState = useUserPreferencesStore.getState() as unknown as Record<
    string,
    unknown
  >;
  const scheduleState =
    useScheduleViewPreferences.getState() as unknown as Record<string, unknown>;
  const mainChanges = changedPreferences(mainState, main, Object.keys(main));
  const scheduleChanges = changedPreferences(
    scheduleState,
    schedule,
    Object.keys(schedule),
  );
  if (Object.keys(mainChanges).length > 0) {
    useUserPreferencesStore.setState(mainChanges);
  }
  if (Object.keys(scheduleChanges).length > 0) {
    useScheduleViewPreferences.setState(scheduleChanges);
  }
}
