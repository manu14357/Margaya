import type { NOTIFICATION_SOUNDS } from "../user/schema";
import { notificationCreatedEvent } from "./created-event";
import { isQuietTime, minutesInZone, validTimeZone } from "./quiet";

export { validTimeZone };

// Which sound Margaya Desktop's native alert for a notification plays, if
// any: the same rules the web app applies to its in-app sound
// (apps/web/src/lib/notification-sound/settings.ts), from the user's synced
// `notificationSound` preference. Keep the two in step. The desktop app
// renders the named sound itself (a port of the web app's recipes).

type SoundChoice = (typeof NOTIFICATION_SOUNDS)[number];

export type NotificationSoundPreference = {
  enabled: boolean;
  volume: number;
  mentions: SoundChoice;
  agents: SoundChoice;
  replies: SoundChoice;
  other: SoundChoice;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
};

/** The web app's defaults, for a user who never changed the setting. */
export const DEFAULT_NOTIFICATION_SOUND: NotificationSoundPreference = {
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

type SoundCategory = "mentions" | "agents" | "replies" | "other";

function soundCategory(
  type: string,
  reply: boolean,
  needsInput: boolean,
): SoundCategory {
  switch (type) {
    case "task_mention":
    case "page_mention":
    case "task_assignee_changed":
      return "mentions";
    case "ai_approval_requested":
      return "agents";
    case "ai_agent_reply":
      return needsInput ? "agents" : "replies";
    case "task_comment":
      return reply ? "replies" : "other";
    default:
      return "other";
  }
}

export type DesktopSound = {
  /** The sound to play, or null when the alert stays silent. */
  soundName: Exclude<SoundChoice, "none"> | null;
  /** The user's notification volume, 0 to 100. */
  volume: number;
};

type DesktopSoundInput = {
  preference: NotificationSoundPreference | undefined;
  notification: {
    id: string;
    userId: string;
    type: string;
    eventData: unknown;
  };
  now: Date;
  timeZone: string | null;
  /**
   * The quiet-time decision for this notification (quiet hours, focus mode
   * and bypasses, from ./quiet). Left out, only the sound's own quiet hours
   * count.
   */
  quiet?: boolean;
};

/**
 * The sound the user's settings call for with this notification now, and
 * their volume. Silent when sounds are off, at volume 0, with no sound
 * chosen for the kind, or in quiet time (quiet hours or focus mode, unless
 * the notification bypasses them). Quiet hours use the account time zone,
 * else the zone the desktop app reports, else UTC.
 */
export function desktopSound(input: DesktopSoundInput): DesktopSound {
  const preference = input.preference ?? DEFAULT_NOTIFICATION_SOUND;
  const silent = { soundName: null, volume: preference.volume };
  if (!preference.enabled || preference.volume === 0) return silent;
  const quiet =
    input.quiet ??
    isQuietTime(preference, minutesInZone(input.now, input.timeZone ?? "UTC"));
  if (quiet) return silent;
  const hint = notificationCreatedEvent(input.notification);
  const choice =
    preference[
      soundCategory(hint.notificationType, hint.reply, hint.needsInput)
    ];
  return choice === "none"
    ? silent
    : { soundName: choice, volume: preference.volume };
}

/** True when the user's sound settings call for a sound now. */
export function wantsDesktopSound(input: DesktopSoundInput): boolean {
  return desktopSound(input).soundName !== null;
}
