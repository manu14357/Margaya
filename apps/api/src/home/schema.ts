import { z } from "../openapi";
import { HOME_WIDGET_KEYS } from "./widgets";

export const HOME_PREFERENCES_BODY_BYTES = 4 * 1024;

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const homeWidgetKey = z.enum(HOME_WIDGET_KEYS).openapi({
  description:
    "A Home widget: quick-links, recents, stickies, risks (the top risks of your current cycles; shown to people with analytics:read) or my-brief (your daily brief; opt-in, off until you turn it on).",
});

export const homeWidgetSchema = z
  .object({
    key: homeWidgetKey,
    enabled: z.boolean(),
  })
  .openapi("HomeWidget");

export const updateHomePreferencesBody = z.object({
  workspaceId: z.string(),
  widgets: z.array(homeWidgetSchema).openapi({
    description:
      "Every Home widget exactly once, in display order, each shown or hidden.",
  }),
});
