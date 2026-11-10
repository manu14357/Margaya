/** The page the API sends the browser to when the desktop app asks to sign in. */
export const DESKTOP_AUTHORIZE_PATH = "/desktop/authorize";

/** The desktop app's own callback scheme; nothing else may be opened. */
const DESKTOP_CALLBACK_PROTOCOL = "com.margaya.desktop:";

export type DesktopAuthorizeRequest = {
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
};

// Same limits as the API (apps/api/src/utils/desktop-sign-in.ts).
const STATE = /^[A-Za-z0-9._~-]{8,256}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** The request in the page's query, or null when it can't be valid. */
export function parseDesktopAuthorizeRequest(search: {
  state?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
}): DesktopAuthorizeRequest | null {
  const { state, code_challenge, code_challenge_method } = search;
  if (
    typeof state !== "string" ||
    typeof code_challenge !== "string" ||
    code_challenge_method !== "S256" ||
    !STATE.test(state) ||
    !CHALLENGE.test(code_challenge)
  ) {
    return null;
  }
  return { state, code_challenge, code_challenge_method };
}

/** This page's path and query, for the sign-in page to come back to. */
export function desktopAuthorizeReturnPath(
  request: DesktopAuthorizeRequest,
  display?: "code",
) {
  const query = new URLSearchParams({
    ...request,
    ...(display ? { display } : {}),
  });
  return `${DESKTOP_AUTHORIZE_PATH}?${query}`;
}

/**
 * The /auth pages send a signed-in visitor to the dashboard. A sign-in that
 * started from the desktop app must come back here instead; this returns the
 * path when `redirect` is exactly this page on this app, else null.
 */
export function desktopAuthorizeRedirect(redirect: unknown): string | null {
  if (typeof redirect !== "string" || !redirect.startsWith("/")) return null;
  if (/^\/[/\\]/.test(redirect)) return null;
  try {
    const base = "https://app.invalid";
    const url = new URL(redirect, base);
    if (url.origin !== base || url.pathname !== DESKTOP_AUTHORIZE_PATH) {
      return null;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/** Whether a URL from the server opens the desktop app and nothing else. */
export function isDesktopCallbackUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === DESKTOP_CALLBACK_PROTOCOL;
  } catch {
    return false;
  }
}
