import { authClient } from "@/lib/auth-client";
import {
  getDesktopSignInPopup,
  isDesktopApp,
  onNextWindowFocus,
} from "@/lib/desktop";

/**
 * Links a social account (GitHub, ...) to the signed-in user. In a browser,
 * Better Auth sends this page to the provider as usual. Inside the desktop
 * app, the provider's page opens in the app's sign-in popup instead, which
 * shares this window's session (the OAuth state cookie lives there) and
 * closes when the provider sends it back. An app version without the popup
 * keeps the redirect, which the app itself may catch. Either way, inside the
 * app `onReturn` runs when this window has the focus again.
 */
export async function linkSocialAccount(
  provider: string,
  callbackURL: string,
  onReturn?: () => void,
): Promise<void> {
  const popup = getDesktopSignInPopup();
  const result = await authClient.linkSocial({
    provider,
    callbackURL,
    ...(popup ? { disableRedirect: true } : {}),
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Could not link the account");
  }
  if (popup) {
    const url = result.data?.url;
    if (typeof url !== "string" || !popup(url)) {
      throw new Error("Could not open the sign-in window");
    }
  }
  if (onReturn && isDesktopApp()) onNextWindowFocus(onReturn);
}
