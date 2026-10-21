import { z } from "../openapi";
import { userPreferencesShape } from "./schema";

export const avatarSchema = z
  .object({
    id: z.string(),
    url: z.string().openapi({
      description:
        "Public URL for the stored avatar, served from /api/user/avatar/{id}.",
    }),
    size: z.number().openapi({ description: "Decoded size in bytes." }),
  })
  .openapi("UserAvatar");

export const avatarDeletedSchema = z
  .object({
    deleted: z.boolean().openapi({
      description: "False when the user had no uploaded avatar to remove.",
    }),
  })
  .openapi("UserAvatarDeleted");

export const userSessionSchema = z
  .object({
    id: z.string(),
    userAgent: z.string().nullable().openapi({
      description: "The browser's user agent when the session started.",
    }),
    ipAddress: z.string().nullable().openapi({
      description: "The client IP when the session started, if known.",
    }),
    createdAt: z.string().openapi({ description: "When the session started." }),
    lastActiveAt: z.string().openapi({
      description:
        "When the session was last refreshed. Sessions refresh about once a day of use, so this is approximate.",
    }),
    expiresAt: z.string(),
    current: z.boolean().openapi({
      description: "True for the session that made this request.",
    }),
  })
  .openapi("UserSession");

export const accountSecuritySchema = z
  .object({
    hasPassword: z.boolean().openapi({
      description:
        "Whether the account can sign in with a password (and so change it).",
    }),
    twoFactorEnabled: z.boolean().openapi({
      description:
        "Whether password sign-in asks for an authenticator code (TOTP).",
    }),
    sessions: z.array(userSessionSchema).openapi({
      description: "Active sessions, most recently active first.",
    }),
  })
  .openapi("AccountSecurity");

export const sessionRevokedSchema = z
  .object({ revoked: z.literal(true) })
  .openapi("UserSessionRevoked");

export const userTimezoneSchema = z
  .object({
    timezone: z.string().nullable().openapi({
      description:
        "The user's IANA time zone, or null when not chosen (the server uses UTC).",
    }),
  })
  .openapi("UserTimezone");

export const userPreferencesSchema = z
  .object({
    preferences: z.object(userPreferencesShape).partial().nullable().openapi({
      description:
        "The stored preferences, or null when the user never saved any. Missing keys use the client's defaults.",
    }),
  })
  .openapi("UserPreferences");
