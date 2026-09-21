import type { TFunction } from "i18next";
import { z } from "zod/v4";

// The server's rules (Better Auth's defaults), as the sign-up form uses them.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** A new password, checked as sign-up checks it. */
export function newPasswordField(t: TFunction) {
  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, {
      message: t("auth:signUpForm.passwordTooShort"),
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
