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
