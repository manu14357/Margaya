// Quiet hours and focus mode, kept per user on the server
// (`quietDelivery`, `focusUntil` and the quiet hours inside
// `notificationSound` in GET/PATCH /user/preferences). The server decides
// what is held (apps/api/src/notification/quiet.ts); this file shows the
// same state and works out when a focus session ends. Keep the two in step.

import { isQuietTime, minutesInZone } from "@/lib/notification-sound/settings";

/** Outbound channels quiet time may hold back. */
export const QUIET_CHANNELS = [
  "push",
  "email",
  "desktop",
  "ntfy",
  "gotify",
  "webhook",
] as const;
export type QuietChannel = (typeof QUIET_CHANNELS)[number];

/** Notifications that may still come through during quiet time. */
export const QUIET_BYPASS = ["mentions", "urgent", "approvals"] as const;
export type QuietBypass = (typeof QUIET_BYPASS)[number];

export type QuietDelivery = {
  channels: QuietChannel[];
  bypass: QuietBypass[];
};

/** Every channel held, nothing bypasses: the server's default too. */
export const DEFAULT_QUIET_DELIVERY: QuietDelivery = {
  channels: [...QUIET_CHANNELS],
  bypass: [],
};

/** The longest focus session the server accepts. */
export const MAX_FOCUS_MS = 7 * 24 * 60 * 60 * 1000;

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[],
): T[] {
  if (!Array.isArray(value)) return fallback;
  // In the canonical order, without repeats.
  return allowed.filter((item) => value.includes(item));
}

/** A valid delivery setting from whatever was stored. */
export function normalizeQuietDelivery(value: unknown): QuietDelivery {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_QUIET_DELIVERY;
  }
  const raw = value as Record<string, unknown>;
  const d = DEFAULT_QUIET_DELIVERY;
  const clean = {
    channels: pick(raw.channels, QUIET_CHANNELS, d.channels),
    bypass: pick(raw.bypass, QUIET_BYPASS, d.bypass),
  };
  // The defaults object itself, so the preference sync treats an untouched
  // setting as never chosen.
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((item, index) => item === b[index]);
  return same(clean.channels, d.channels) && same(clean.bypass, d.bypass)
    ? d
    : clean;
}

/** An ISO instant, or null for anything else. */
export function normalizeFocusUntil(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function safeZone(timeZone: string | null): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function offsetMs(instant: Date, timeZone: string): number {
  const c = wallClock(instant, timeZone);
  const asUtc = Date.UTC(
    c.year,
    c.month - 1,
    c.day,
    c.hour,
    c.minute,
    c.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time `days` after `from`'s date reads HH:MM. */
function atClock(
  from: Date,
  days: number,
  clock: string,
  timeZone: string,
): Date {
  const today = wallClock(from, timeZone);
  const [h, m] = clock.split(":").map(Number);
  const local = Date.UTC(
    today.year,
    today.month - 1,
    today.day + days,
    h ?? 0,
    m ?? 0,
  );
  // Twice, so a daylight-saving change between the guesses settles.
  let instant = local - offsetMs(new Date(local), timeZone);
  instant = local - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export const FOCUS_PRESETS = ["30m", "1h", "2h", "tomorrow"] as const;
export type FocusPreset = (typeof FOCUS_PRESETS)[number];

/**
 * When a focus session started now ends. "tomorrow" ends tomorrow morning
 * in the account time zone: when quiet hours end, else at 09:00.
 */
export function focusEnd(
  preset: FocusPreset,
  now: Date,
  timeZone: string | null,
  quietEnd: string | null = null,
): Date {
  switch (preset) {
    case "30m":
      return new Date(now.getTime() + 30 * 60 * 1000);
    case "1h":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "2h":
      return new Date(now.getTime() + 2 * 60 * 60 * 1000);
    case "tomorrow":
      return atClock(now, 1, quietEnd ?? "09:00", safeZone(timeZone));
  }
}

/** A custom end: at most MAX_FOCUS_MS ahead, null if not in the future. */
export function clampFocusEnd(end: Date, now: Date): Date | null {
  if (!Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) {
    return null;
  }
  return new Date(Math.min(end.getTime(), now.getTime() + MAX_FOCUS_MS));
}

export type QuietStatus =
  | { kind: "focus"; until: Date }
  | { kind: "quiet"; until: Date }
  | null;

/**
 * Whether notifications are paused now, why, and until when. Focus wins
 * over quiet hours. Quiet hours use the account time zone, else UTC, as
 * the server does.
 */
export function quietStatus(
  input: {
    focusUntil: string | null;
    quietHours: boolean;
    quietStart: string;
    quietEnd: string;
  },
  now: Date,
  timeZone: string | null,
): QuietStatus {
  const focus = input.focusUntil ? Date.parse(input.focusUntil) : Number.NaN;
  if (Number.isFinite(focus) && focus > now.getTime()) {
    return { kind: "focus", until: new Date(focus) };
  }
  const zone = safeZone(timeZone);
  const minutes = minutesInZone(now, zone);
  if (!isQuietTime(input, minutes)) return null;
  const [h, m] = input.quietEnd.split(":").map(Number);
  const endMinutes = (h ?? 0) * 60 + (m ?? 0);
  return {
    kind: "quiet",
    until: atClock(now, minutes < endMinutes ? 0 : 1, input.quietEnd, zone),
  };
}
