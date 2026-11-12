import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

export const calendarFeedSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["my_tasks", "planning", "project"]),
    workspaceId: z.string(),
    projectId: z.string().nullable(),
    /** Null when the project is now hidden from the owner. */
    projectName: z.string().nullable(),
    name: z.string(),
    tokenStart: z.string().openapi({
      description: "The first characters of the URL token, to tell feeds apart",
    }),
    createdAt: responseTimestamp,
    lastUsedAt: nullableResponseTimestamp,
  })
  .openapi("CalendarFeed");

export const calendarFeedListSchema = z.array(calendarFeedSchema);

export const createdCalendarFeedSchema = calendarFeedSchema
  .extend({
    url: z.string().openapi({
      description:
        "The secret https subscription URL. Shown only now; only a hash is stored.",
    }),
    webcalUrl: z.string().openapi({
      description:
        "The same URL with the webcal scheme, to open a calendar app",
    }),
  })
  .openapi("CreatedCalendarFeed");
