import { HttpError } from "@/lib/http-error";

// Agent schedules in the UI: the cron presets the editor offers, how a
// schedule reads in the list, time zones, and the API's error codes as
// static i18n keys.

export type SchedulePreset = {
  id: "weekdays" | "mondays" | "monthly";
  cron: string;
  labelKey: string;
};

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  {
    id: "weekdays",
    cron: "0 9 * * 1-5",
    labelKey: "ai:agents.schedules.presets.weekdays",
  },
  {
    id: "mondays",
    cron: "0 9 * * 1",
    labelKey: "ai:agents.schedules.presets.mondays",
  },
  {
    id: "monthly",
    cron: "0 9 1 * *",
    labelKey: "ai:agents.schedules.presets.monthly",
  },
];

export const CUSTOM_PRESET = "custom";

/** Collapses spacing so "0  9 * * 1" matches its preset. */
export function normalizeCron(cron: string): string {
  return cron.trim().split(/\s+/).join(" ");
}

/** The preset a cron expression is, or "custom". */
export function presetOf(cron: string): SchedulePreset["id"] | "custom" {
  const normalized = normalizeCron(cron);
  return (
    SCHEDULE_PRESETS.find((preset) => preset.cron === normalized)?.id ??
    CUSTOM_PRESET
  );
}

/** Five fields of cron characters; the API checks the rest. */
export function looksLikeCron(cron: string): boolean {
  const fields = normalizeCron(cron).split(" ");
  return (
    fields.length === 5 &&
    fields.every((field) => /^[\d*,/\-A-Za-z]+$/.test(field))
  );
}

/** How a schedule's timing reads: a preset's name, or the raw cron. */
export function cronLabel(cron: string): {
  key: string;
  values?: Record<string, string>;
} {
  const preset = SCHEDULE_PRESETS.find(
    (entry) => entry.cron === normalizeCron(cron),
  );
  return preset
    ? { key: preset.labelKey }
    : {
        key: "ai:agents.schedules.customLabel",
        values: { cron: normalizeCron(cron) },
      };
}

const ERROR_KEYS: Record<string, string> = {
  CRON_INVALID: "ai:agents.schedules.errors.CRON_INVALID",
  CRON_TOO_FREQUENT: "ai:agents.schedules.errors.CRON_TOO_FREQUENT",
  CRON_NEVER: "ai:agents.schedules.errors.CRON_NEVER",
  TIMEZONE_INVALID: "ai:agents.schedules.errors.TIMEZONE_INVALID",
  OUTSIDE_AGENT_PROJECTS: "ai:agents.schedules.errors.OUTSIDE_AGENT_PROJECTS",
};

/** The stable code in an API error body, if any. */
export function errorCode(error: unknown): string | null {
  if (!(error instanceof HttpError)) return null;
  try {
    const code = (JSON.parse(error.message) as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/** The i18n key for a failed save. */
export function scheduleErrorKey(error: unknown): string {
  const code = errorCode(error);
  return (code && ERROR_KEYS[code]) || "ai:agents.schedules.saveError";
}

/** The browser's IANA time zone, or UTC. */
export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Every IANA time zone the browser knows, with `current` included. */
export function timeZones(current?: string): string[] {
  let zones: string[] = [];
  try {
    zones =
      (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const all = new Set(["UTC", ...zones]);
  if (current) all.add(current);
  return [...all].sort((a, b) => a.localeCompare(b));
}
