import { z } from "../openapi";
import { MAX_AVATAR_INPUT_CHARS } from "./avatar";

export const uploadAvatarBody = z.object({
  contentType: z.string().max(64).openapi({
    description: "One of image/png, image/jpeg, or image/webp.",
    example: "image/png",
  }),
  data: z
    .string()
    .max(MAX_AVATAR_INPUT_CHARS)
    .openapi({ description: "Base64 encoded image bytes." }),
});

export const sessionParam = z.object({
  id: z.string().min(1).max(255).openapi({
    description: "The session id from GET /user/security.",
  }),
});

export const updateUserTimezoneBody = z.object({
  timezone: z.string().min(1).max(64).nullable().openapi({
    description:
      'IANA time zone name such as "America/New_York", or null to clear it. Raw offsets are rejected.',
    example: "America/New_York",
  }),
});

// Per-user web preferences. Every key is optional: the client keeps its own
// default for a key the server does not hold. Keep in step with the web
// store (`apps/web/src/store/user-preferences.ts`).
export const USER_THEMES = [
  "light",
  "dark",
  "system",
  "light-contrast",
  "dark-contrast",
] as const;

/** Rail destinations a user may reorder or hide; Settings is fixed. */
export const SIDEBAR_RAIL_ITEMS = [
  "home",
  "inbox",
  "my-work",
  "projects",
  "pages",
  "analytics",
] as const;

/** Sections of the Projects panel a user may reorder or hide. */
export const SIDEBAR_PANEL_SECTIONS = [
  "views",
  "favorites",
  "projects",
] as const;

/** Built-in notification sounds the web app plays; "none" is silence. */
export const NOTIFICATION_SOUNDS = [
  "none",
  "chime",
  "pop",
  "ding",
  "bell",
  "knock",
  "marimba",
] as const;

const notificationSoundChoice = z.enum(NOTIFICATION_SOUNDS);
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Outbound channels quiet hours and focus mode may hold back. */
export const QUIET_CHANNELS = [
  "push",
  "email",
  "desktop",
  "ntfy",
  "gotify",
  "webhook",
] as const;

/** Notifications that may still come through during quiet time. */
export const QUIET_BYPASS = ["mentions", "urgent", "approvals"] as const;

// Focus mode ends at most this far ahead; a longer pause would let agent
// approvals (24 hours) and due-date reminders lapse unseen for too long.
export const MAX_FOCUS_MS = 7 * 24 * 60 * 60 * 1000;

export const userPreferencesShape = {
  theme: z.enum(USER_THEMES).openapi({
    description:
      "Color theme. `system` follows the device; the contrast themes are high-contrast variants.",
  }),
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]).openapi({
    description: "First day of the week: 0 Sunday, 1 Monday, 6 Saturday.",
  }),
  viewMode: z.enum(["board", "list"]),
  showTaskNumbers: z.boolean(),
  showAssignees: z.boolean(),
  showDueDates: z.boolean(),
  showLabels: z.boolean(),
  showPriority: z.boolean(),
  showEstimates: z.boolean(),
  showTaskItemCounts: z.boolean(),
  sidebarDefaultOpen: z.boolean(),
  activityFilter: z.enum(["all", "comments", "updates", "agents"]),
  activitySort: z.enum(["newest", "oldest"]),
  pagesFormatToolbar: z.boolean().openapi({
    description: "Show the fixed formatting toolbar above editable pages.",
  }),
  myBriefEmail: z.boolean().openapi({
    description:
      "Add My brief (your blocked tasks and changes on tasks you follow) to the email digest. Off unless turned on; needs a daily or weekly digest.",
  }),
  notificationSound: z
    .object({
      enabled: z.boolean(),
      volume: z.number().int().min(0).max(100),
      mentions: notificationSoundChoice,
      agents: notificationSoundChoice,
      replies: notificationSoundChoice,
      other: notificationSoundChoice,
      quietHours: z.boolean(),
      quietStart: clockTime,
      quietEnd: clockTime,
    })
    .strict()
    .openapi({
      description:
        "Sounds for in-app notifications. `mentions` covers mentions and assignments, `agents` an agent's question or approval request, `replies` replies in your threads and agents' answers, `other` everything else. Quiet hours (HH:MM, in the account time zone) silence them and hold the channels in `quietDelivery`; a range may cross midnight.",
    }),
  quietDelivery: z
    .object({
      channels: z.array(z.enum(QUIET_CHANNELS)).max(QUIET_CHANNELS.length),
      bypass: z.array(z.enum(QUIET_BYPASS)).max(QUIET_BYPASS.length),
    })
    .strict()
    .openapi({
      description:
        "What quiet hours and focus mode hold back. `channels` are held until quiet time ends, then each gets one summary (webhooks get each held payload). `bypass` lets `mentions` (task and page mentions), `urgent` (being assigned an urgent task) and `approvals` (an agent's approval request or question) through. Left unset, every channel is held and nothing bypasses. The in-app inbox always fills.",
    }),
  focusUntil: z.iso
    .datetime({ offset: true })
    .refine((value) => Date.parse(value) <= Date.now() + MAX_FOCUS_MS, {
      message: "Focus can last at most 7 days",
    })
    .nullable()
    .openapi({
      description:
        "Focus mode: until this instant, notifications are held and silenced like quiet hours. Null or a past instant means off. At most 7 days ahead.",
      example: "2026-11-13T15:30:00Z",
    }),
  calendarMode: z.enum(["month", "week"]),
  calendarShowWeekends: z.boolean(),
  ganttZoom: z.enum(["week", "month", "quarter"]),
  sidebarLayout: z
    .object({
      railOrder: z.array(z.enum(SIDEBAR_RAIL_ITEMS)).max(20),
      railHidden: z.array(z.enum(SIDEBAR_RAIL_ITEMS)).max(20),
      panelOrder: z.array(z.enum(SIDEBAR_PANEL_SECTIONS)).max(20),
      panelHidden: z.array(z.enum(SIDEBAR_PANEL_SECTIONS)).max(20),
    })
    .strict()
    .nullable()
    .openapi({
      description:
        "The user's own sidebar: the order of the rail destinations (Settings stays at the foot) and of the Projects panel sections, and which of them are hidden. Items missing from an order follow in the default order. Null restores the default.",
    }),
};

export type UserPreferenceKey = keyof typeof userPreferencesShape;

export const updateUserPreferencesBody = z
  .object(userPreferencesShape)
  .partial()
  .strict()
  .openapi("UpdateUserPreferencesBody", {
    description:
      "The preferences to change; keys left out keep their stored value.",
  });
