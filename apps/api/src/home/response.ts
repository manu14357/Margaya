import { nullableResponseTimestamp, z } from "../openapi";
import { homeWidgetSchema } from "./schema";

export const homePreferencesSchema = z
  .object({
    workspaceId: z.string(),
    widgets: z.array(homeWidgetSchema).openapi({
      description:
        "Every Home widget in display order. Widgets added after the caller last saved are appended, enabled.",
    }),
    updatedAt: nullableResponseTimestamp.openapi({
      description: "Null while the caller has never saved (the defaults).",
    }),
  })
  .openapi("HomePreferences");
