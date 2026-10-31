// Notification sound preferences, kept per user on the server
// (`notificationSound` in GET/PATCH /user/preferences). Keep in step with
// `apps/api/src/user/schema.ts`.

export const NOTIFICATION_SOUNDS = [
  "none",
  "chime",
  "pop",
  "ding",
  "bell",
  "knock",
  "marimba",
] as const;
export type NotificationSoundId = (typeof NOTIFICATION_SOUNDS)[number];

/** What a notification is about, for picking its sound. */
export const SOUND_CATEGORIES = [
  "mentions",
  "agents",
  "replies",
  "other",
] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

export type NotificationSoundSettings = {
  enabled: boolean;
  /** 0 to 100. */
  volume: number;
  quietHours: boolean;
  /** HH:MM in the account time zone; the range may cross midnight. */
  quietStart: string;
  quietEnd: string;
} & Record<SoundCategory, NotificationSoundId>;

// On, for what needs you; everything else stays silent until chosen.
export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundSettings = {
  enabled: true,
  volume: 70,
  mentions: "chime",
  agents: "knock",
  replies: "pop",
  other: "none",
  quietHours: false,
  quietStart: "22:00",
  quietEnd: "08:00",
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isNotificationSound(
  value: unknown,
): value is NotificationSoundId {
  return NOTIFICATION_SOUNDS.some((sound) => sound === value);
}

/**
 * A complete, valid settings object from whatever was stored: unknown or
 * broken fields fall back to their defaults one by one.
 */
export function normalizeNotificationSound(
  value: unknown,
): NotificationSoundSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_NOTIFICATION_SOUND;
  }
  const raw = value as Record<string, unknown>;
  const d = DEFAULT_NOTIFICATION_SOUND;
  const sound = (key: SoundCategory) =>
    isNotificationSound(raw[key]) ? raw[key] : d[key];
  const clock = (key: "quietStart" | "quietEnd") =>
    typeof raw[key] === "string" && CLOCK.test(raw[key]) ? raw[key] : d[key];
  const clean: NotificationSoundSettings = {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    volume:
      typeof raw.volume === "number" && Number.isFinite(raw.volume)
        ? Math.round(Math.min(100, Math.max(0, raw.volume)))
        : d.volume,
    mentions: sound("mentions"),
    agents: sound("agents"),
    replies: sound("replies"),
    other: sound("other"),
    quietHours:
      typeof raw.quietHours === "boolean" ? raw.quietHours : d.quietHours,
    quietStart: clock("quietStart"),
    quietEnd: clock("quietEnd"),
  };
  // The defaults object itself, so the preference sync treats an untouched
  // setting as never chosen.
  const isDefault = (
    Object.keys(d) as (keyof NotificationSoundSettings)[]
  ).every((key) => clean[key] === d[key]);
  return isDefault ? d : clean;
}

/** The NOTIFICATION_CREATED hint's fields that pick a category. */
export type NotificationHint = {
  notificationType?: string | null;
  reply?: boolean;
  needsInput?: boolean;
};

/**
 * Mentions and assignments; an agent waiting on you; replies in your
 * threads and agents' answers; everything else.
 */
export function soundCategory(hint: NotificationHint): SoundCategory {
  switch (hint.notificationType) {
    case "task_mention":
    case "page_mention":
    case "task_assignee_changed":
      return "mentions";
    case "ai_approval_requested":
      return "agents";
    case "ai_agent_reply":
      return hint.needsInput ? "agents" : "replies";
    case "task_comment":
      return hint.reply ? "replies" : "other";
    default:
      return "other";
  }
}

function minutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes since midnight in a time zone; the device's zone when unknown. */
export function minutesInZone(now: Date, timeZone: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timeZone ?? undefined,
    }).formatToParts(now);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    return get("hour") * 60 + get("minute");
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

/** Start inclusive, end exclusive; equal times mean no quiet hours. */
export function isQuietTime(
  settings: Pick<
    NotificationSoundSettings,
    "quietHours" | "quietStart" | "quietEnd"
  >,
  nowMinutes: number,
): boolean {
  if (!settings.quietHours) return false;
  const start = minutes(settings.quietStart);
  const end = minutes(settings.quietEnd);
  if (start === end) return false;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

/** The sound a notification should play, or null for silence. */
export function soundFor(
  settings: NotificationSoundSettings,
  hint: NotificationHint,
  nowMinutes: number,
): NotificationSoundId | null {
  if (!settings.enabled || settings.volume === 0) return null;
  if (isQuietTime(settings, nowMinutes)) return null;
  const sound = settings[soundCategory(hint)];
  return sound === "none" ? null : sound;
}
