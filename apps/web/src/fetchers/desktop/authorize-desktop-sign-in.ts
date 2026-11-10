import { authClient } from "@/lib/auth-client";
import type { DesktopAuthorizeRequest } from "@/lib/desktop-authorize";
import { HttpError } from "@/lib/http-error";

export type DesktopAuthorization = { code: string; redirectTo: string };

/**
 * Mints the desktop app's one-time sign-in code for this session. A Better
 * Auth endpoint, so it goes through the auth client, which sends the cookie.
 */
async function authorizeDesktopSignIn(
  request: DesktopAuthorizeRequest,
): Promise<DesktopAuthorization> {
  const { data, error } = await authClient.$fetch<DesktopAuthorization>(
    "/desktop/authorize",
    { method: "POST", body: request },
  );
  if (error || !data) {
    throw new HttpError(
      error?.status ?? 500,
      error?.message || "Couldn't authorize the desktop app.",
    );
  }
  return data;
}

export default authorizeDesktopSignIn;
