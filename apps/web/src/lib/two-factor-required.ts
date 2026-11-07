import type { QueryClient } from "@tanstack/react-query";
import { getConfig } from "@/fetchers/config/get-config";
import getAccountSecurity from "@/fetchers/user/get-account-security";
import { HttpError } from "./http-error";

// The instance can require two-factor (instance setting auth.requireTwoFactor).
// The API enforces it: an account that must set it up gets 403 with code
// TWO_FACTOR_REQUIRED from everything else. Here that only decides where the
// person goes: to the setup screen, and back again afterwards.

export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";
export const TWO_FACTOR_SETUP_PATH = "/two-factor-setup";

// How long a navigation trusts its copy of the settings, so that requiring
// two-factor reaches open tabs soon after an admin turns it on.
const CONFIG_FRESH_MS = 60_000;

/** A failed request that only says "set up two-factor first". */
export function isTwoFactorRequired(error: unknown): boolean {
  if (!(error instanceof HttpError) || error.status !== 403) return false;
  try {
    const body = JSON.parse(error.message) as { code?: unknown };
    return body.code === TWO_FACTOR_REQUIRED;
  } catch {
    return false;
  }
}

/** Sends the person to the setup screen, remembering where they were. */
export function handleTwoFactorRequired(): void {
  const { pathname, search, hash } = window.location;
  if (pathname === TWO_FACTOR_SETUP_PATH) return;
  const current = encodeURIComponent(pathname + search + hash);
  window.location.replace(`${TWO_FACTOR_SETUP_PATH}?redirect=${current}`);
}

/** Where to go after the setup screen: a path in this app, nowhere else. */
export function returnPathAfterSetup(target: string | undefined): string {
  return target?.startsWith("/") && !target.includes("//")
    ? target
    : "/dashboard";
}

/**
 * Whether the signed-in account has to set up two-factor before anything else.
 * A failure answers false: the API still refuses, and that sends them here.
 */
export async function needsTwoFactorSetup(
  queryClient: QueryClient,
): Promise<boolean> {
  try {
    const config = await queryClient.fetchQuery({
      queryKey: ["config"],
      queryFn: getConfig,
      staleTime: CONFIG_FRESH_MS,
    });
    if (!config.requireTwoFactor) return false;
    const security = await getAccountSecurity();
    return security.twoFactorRequired && !security.twoFactorEnabled;
  } catch {
    return false;
  }
}
