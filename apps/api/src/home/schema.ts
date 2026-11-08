import { z } from "../openapi";
import { HOME_WIDGET_KEYS, MAX_PINNED_REPORTS } from "./widgets";

export const HOME_PREFERENCES_BODY_BYTES = 4 * 1024;

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const homeWidgetKey = z.enum(HOME_WIDGET_KEYS).openapi({
  description:
    "A Home widget: quick-links, recents, stickies, risks (the top risks of your current cycles; shown to people with analytics:read) my-brief (your daily brief; opt-in, off until you turn it on) or pinned-reports (saved analytics reports you pinned; opt-in, shown to people with analytics:read).",
});

export const homeWidgetSchema = z
  .object({
    key: homeWidgetKey,
    enabled: z.boolean(),
    reportIds: z
      .array(z.string().min(1).max(64))
      .max(MAX_PINNED_REPORTS)
      .optional()
      .openapi({
        description:
          "pinned-reports only: the saved reports to show, in order. An id you can't see (deleted, or made private) shows nothing. Ignored on other widgets.",
      }),
  })
  .openapi("HomeWidget");

export const updateHomePreferencesBody = z.object({
  workspaceId: z.string(),
  widgets: z.array(homeWidgetSchema).openapi({
    description:
      "Every Home widget exactly once, in display order, each shown or hidden.",
  }),
});
