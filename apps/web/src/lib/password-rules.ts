import type { TFunction } from "i18next";
import { z } from "zod/v4";

// The server's rules (apps/api/src/utils/password-policy.ts). The length is
// checked here as the user types; whether a password is too common or
// matches the email is decided by the server, and its codes map to copy
// through passwordPolicyMessage.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** A new password, checked as sign-up checks it. */
export function newPasswordField(t: TFunction) {
  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, {
      message: t("accountSecurity:password.tooShort", {
        min: PASSWORD_MIN_LENGTH,
      }),
    })
    .max(PASSWORD_MAX_LENGTH, { message: t("auth:forms.passwordTooLong") });
}

/** A new password typed twice; the mismatch shows under the confirmation. */
export function newPasswordPairSchema(t: TFunction) {
  return z
    .object({
      newPassword: newPasswordField(t),
      confirmPassword: z.string(),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      message: t("auth:forms.passwordsDoNotMatch"),
      path: ["confirmPassword"],
    });
}

/** The hint shown under a new-password field. */
export function passwordHint(t: TFunction) {
  return t("accountSecurity:password.hint", { min: PASSWORD_MIN_LENGTH });
}

/**
 * Copy for a password the server refused (Better Auth error code), or null
 * when the error is about something else.
 */
export function passwordPolicyMessage(
  t: TFunction,
  code: string | undefined | null,
): string | null {
  switch (code) {
    case "PASSWORD_TOO_SHORT":
      return t("accountSecurity:password.tooShort", {
        min: PASSWORD_MIN_LENGTH,
      });
    case "PASSWORD_TOO_LONG":
      return t("auth:forms.passwordTooLong");
    case "PASSWORD_TOO_COMMON":
      return t("accountSecurity:password.tooCommon");
    case "PASSWORD_MATCHES_EMAIL":
      return t("accountSecurity:password.matchesEmail");
    default:
      return null;
  }
}
