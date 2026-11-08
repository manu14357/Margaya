import type { TFunction } from "i18next";

type AuthError = { code?: string; message?: string } | null | undefined;

/**
 * Better Auth refuses a banned account wherever a session would start: the
 * password, the email code and the two-factor step. Its message is English,
 * so these screens show the copy the sign-in page has for the same code in
 * its URL (auth.signIn.errors.banned_user).
 */
export function isBannedError(error: AuthError): boolean {
  return error?.code === "BANNED_USER";
}

/** What a refused sign-in says: the ban in the person's language, else the server's message. */
export function signInErrorMessage(
  error: AuthError,
  t: TFunction,
  fallback: string,
): string {
  if (isBannedError(error)) return t("auth:signIn.errors.banned_user");
  return error?.message || fallback;
}
