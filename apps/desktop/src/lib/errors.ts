import type { Translate } from "./i18n";
import { isCommandError } from "./ipc";

/** Where the launcher sends people whose company certificate isn't trusted. */
export const CERTIFICATE_HELP_URL =
  "https://margaya.app/docs/core/functional/desktop-app#private-or-company-certificates";

/** Turns a rejected command into one line of launcher copy. */
export function errorMessage(t: Translate, error: unknown): string {
  if (!isCommandError(error)) {
    return t("errors.generic", { message: String(error) });
  }
  switch (error.kind) {
    case "invalidUrl":
    case "unreachable":
    case "notMargaya":
    case "serverTooOld":
    case "disabled":
    case "tlsUntrusted":
    case "duplicate":
    case "notSignedIn":
    case "signInFailed":
    case "codeInvalid":
    case "quickAddFailed":
    case "keychainUnavailable":
      return t(`errors.${error.kind}`);
    case "desktopTooOld":
      return t("errors.desktopTooOld", { version: error.detail ?? "" });
    default:
      return t("errors.generic", { message: error.message });
  }
}

export function isTlsError(error: unknown): boolean {
  return isCommandError(error) && error.kind === "tlsUntrusted";
}
