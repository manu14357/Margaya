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
