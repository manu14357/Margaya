import { authClient } from "@/lib/auth-client";

/** Query parameter marking a page the provider sent back after a failure. */
export const LINK_ERROR_PARAM = "linkError";

/**
 * Links a social account (GitHub, ...) to the signed-in user: Better Auth
 * sends this page to the provider and back to `callbackURL`. A failure comes
 * back to the same page with `linkError=<provider>` and Better Auth's
 * `error` code; without it Better Auth would land on the API's own origin,
 * which has no page to show.
 */
export async function linkSocialAccount(
  provider: string,
  callbackURL: string,
): Promise<void> {
  const errorCallbackURL = new URL(callbackURL);
  errorCallbackURL.searchParams.set(LINK_ERROR_PARAM, provider);
  const result = await authClient.linkSocial({
    provider,
    callbackURL,
    errorCallbackURL: errorCallbackURL.href,
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Could not link the account");
  }
}

/**
 * The error code of a failed link for `provider` on this page, removed from
 * the address so a reload doesn't report it again; null when there is none.
 */
export function takeLinkError(
  provider: string,
  win: Window = window,
): string | null {
  const url = new URL(win.location.href);
  if (url.searchParams.get(LINK_ERROR_PARAM) !== provider) return null;
  const code = url.searchParams.get("error") || "unknown";
  url.searchParams.delete(LINK_ERROR_PARAM);
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  win.history.replaceState(win.history.state, "", url.href);
  return code;
}
