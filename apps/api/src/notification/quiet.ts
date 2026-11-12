import type { UserPreferences } from "../user/controllers/user-preferences";
import { type QUIET_BYPASS, QUIET_CHANNELS } from "../user/schema";

// Quiet hours and focus mode: whether a user's notifications are held back
// right now, on which channels, and which notifications still come through.
// The web app shows the same state (apps/web/src/lib/quiet-time.ts); keep
// the two in step.

export type QuietChannel = (typeof QUIET_CHANNELS)[number];
export type QuietBypass = (typeof QUIET_BYPASS)[number];

export type QuietSettings = {
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
  channels: readonly QuietChannel[];
  bypass: readonly QuietBypass[];
  focusUntil: string | null;
};

/** Every channel held, nothing bypasses: a user who never chose. */
export const DEFAULT_QUIET_DELIVERY = {
  channels: QUIET_CHANNELS,
  bypass: [] as readonly QuietBypass[],
};

export function quietSettings(preferences: UserPreferences): QuietSettings {
  const sound = preferences.notificationSound;
  const delivery = preferences.quietDelivery ?? DEFAULT_QUIET_DELIVERY;
  return {
    quietHours: sound?.quietHours ?? false,
    quietStart: sound?.quietStart ?? "22:00",
    quietEnd: sound?.quietEnd ?? "08:00",
    channels: delivery.channels,
    bypass: delivery.bypass,
    focusUntil: preferences.focusUntil ?? null,
  };
}

function clockMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A usable IANA zone name, or null. */
export function validTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

export function minutesInZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** Start inclusive, end exclusive; equal times mean no quiet hours. */
export function isQuietTime(
  settings: Pick<QuietSettings, "quietHours" | "quietStart" | "quietEnd">,
  nowMinutes: number,
): boolean {
  if (!settings.quietHours) return false;
  const start = clockMinutes(settings.quietStart);
  const end = clockMinutes(settings.quietEnd);
  if (start === end) return false;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

export function isFocusing(focusUntil: string | null, now: Date): boolean {
  if (!focusUntil) return false;
  const until = Date.parse(focusUntil);
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * True while quiet hours or focus mode hold notifications. Quiet hours use
 * the account time zone, else UTC.
 */
export function isQuietNow(
  settings: QuietSettings,
  now: Date,
  timeZone: string | null,
): boolean {
  return (
    isFocusing(settings.focusUntil, now) ||
    isQuietTime(settings, minutesInZone(now, timeZone ?? "UTC"))
  );
}

/** The bypass group a notification belongs to, if any. */
export function bypassGroup(
  type: string,
  eventData: unknown,
  urgentTask: boolean,
): QuietBypass | null {
  switch (type) {
    case "task_mention":
    case "page_mention":
      return "mentions";
    case "task_assignee_changed":
      return urgentTask ? "urgent" : null;
    case "ai_approval_requested":
      return "approvals";
    case "ai_agent_reply":
      return eventData &&
        typeof eventData === "object" &&
        (eventData as Record<string, unknown>).needsInput === true
        ? "approvals"
        : null;
    default:
      return null;
  }
}

export type QuietDecision = {
  /** Sounds stay off: quiet time, and the notification does not bypass it. */
  quiet: boolean;
  /** The channels that hold this notification instead of sending it. */
  held: ReadonlySet<QuietChannel>;
};

export const NOT_QUIET: QuietDecision = { quiet: false, held: new Set() };

export function quietDecision(input: {
  settings: QuietSettings;
  notification: { type: string; eventData: unknown };
  urgentTask: boolean;
  now: Date;
  timeZone: string | null;
}): QuietDecision {
  const { settings } = input;
  if (!isQuietNow(settings, input.now, input.timeZone)) return NOT_QUIET;
  const group = bypassGroup(
    input.notification.type,
    input.notification.eventData,
    input.urgentTask,
  );
  if (group && settings.bypass.includes(group)) return NOT_QUIET;
  return { quiet: true, held: new Set(settings.channels) };
}
