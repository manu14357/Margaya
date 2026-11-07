import { APIError } from "better-auth/api";
import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { accountTable, ssoProviderTable, userTable } from "../database/schema";
import {
  type DerivedSettings,
  type EffectiveSettings,
  OAUTH_PROVIDERS,
  type OAuthProviderId,
} from "../instance-settings/resolve";
import { getInstanceSettings } from "../instance-settings/snapshot";

// The instance setting auth.requireTwoFactor. Two-factor challenges password
// sign-in only: sign-in providers apply their own checks, and email links and
// codes are refused while the setting is on (sign-in-policy.ts). So it covers
// the accounts that have a password, however they sign in, which also leaves
// out guests and AI agents, who have none. Such an account can do nothing
// until it sets two-factor up, API keys included: a key must not outlive the
// policy it skips.
//
// An account covered here has a password, so it can always reach the setup
// screen. An account that only used email links or codes has no password, so
// it isn't covered, but its way in turns off: it sets a password with Forgot
// password (needs email), or an instance admin sets one under Users, and is
// covered from then on. An admin with no other way in can't turn the setting
// on (settings.ts). A lost authenticator is reset by another instance admin or
// with `margaya-admin reset-two-factor`, `margaya-admin reset-password` sets a
// password from the server, and REQUIRE_TWO_FACTOR=false turns the setting
// off from the server.

export const TWO_FACTOR_REQUIRED = "TWO_FACTOR_REQUIRED";

export const twoFactorRequiredBody = {
  code: TWO_FACTOR_REQUIRED,
  message:
    "This server requires two-factor authentication. Set it up in your account to continue.",
};

type PolicyUser = {
  id: string;
  role?: string | null;
  twoFactorEnabled?: boolean | null;
  isAnonymous?: boolean | null;
};

/** Whether the setting covers this account, whatever its current state. */
export async function twoFactorApplies(
  user: Omit<PolicyUser, "twoFactorEnabled">,
  effective: EffectiveSettings = getInstanceSettings().effective,
): Promise<boolean> {
  if (!effective.requireTwoFactor || user.isAnonymous === true) return false;
  // Nobody signs in with a password on this server, or this account can't:
  // a required provider leaves password sign-in to instance admins.
  if (!effective.emailSignIn) return false;
  if (effective.requiredProvider && user.role !== "admin") return false;
  const [credential] = await db
    .select({ id: accountTable.id })
    .from(accountTable)
    .where(
      and(
        eq(accountTable.userId, user.id),
        eq(accountTable.providerId, "credential"),
        isNotNull(accountTable.password),
      ),
    )
    .limit(1);
  return Boolean(credential);
}

/** Whether this account has to set up two-factor before anything else. */
export async function mustSetUpTwoFactor(
  user: PolicyUser,
  effective: EffectiveSettings = getInstanceSettings().effective,
): Promise<boolean> {
  if (!effective.requireTwoFactor || user.twoFactorEnabled === true) {
    return false;
  }
  return twoFactorApplies(user, effective);
}

/** The same question for an API key's owner, who isn't loaded yet. */
export async function keyOwnerMustSetUpTwoFactor(
  userId: string,
): Promise<boolean> {
  const { effective } = getInstanceSettings();
  if (!effective.requireTwoFactor) return false;
  const [owner] = await db
    .select({
      role: userTable.role,
      twoFactorEnabled: userTable.twoFactorEnabled,
      isAnonymous: userTable.isAnonymous,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return owner
    ? mustSetUpTwoFactor({ id: userId, ...owner }, effective)
    : false;
}

/**
 * Whether an account can still sign in with email links and codes off: with a
 * password, a sign-in provider that works, or a SAML connection. A SCIM link
 * only provisions the account.
 */
export async function signsInWithoutEmail(
  userId: string,
  derived: DerivedSettings,
): Promise<boolean> {
  const accounts = await db
    .select({
      providerId: accountTable.providerId,
      password: accountTable.password,
      saml: ssoProviderTable.id,
    })
    .from(accountTable)
    .leftJoin(
      ssoProviderTable,
      eq(ssoProviderTable.providerId, accountTable.providerId),
    )
    .where(eq(accountTable.userId, userId));
  const providerWorks = (providerId: string) =>
    OAUTH_PROVIDERS.includes(providerId as OAuthProviderId) &&
    derived.providers[providerId as OAuthProviderId].active;
  return accounts.some(({ providerId, password, saml }) =>
    providerId === "credential"
      ? Boolean(password)
      : saml !== null || providerWorks(providerId),
  );
}

/** The REST refusal; the web app sends the person to the setup screen. */
export function twoFactorRequiredError(): HTTPException {
  return new HTTPException(403, {
    res: new Response(JSON.stringify(twoFactorRequiredBody), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  });
}

// What a signed-in account that still has to set up two-factor may call on
// Better Auth: setting it up, signing in and out, and account housekeeping.
// Everything else (workspaces, API keys, the admin endpoints, approving a
// device) is refused, including endpoints a future release adds.
const OPEN_WHILE_SETTING_UP = [
  "/two-factor/",
  "/sign-in/",
  "/sign-up/",
  "/sign-out",
  "/get-session",
  "/callback/",
  "/oauth2/callback/",
  "/sso/saml2/sp/acs/",
  "/magic-link/verify",
  "/email-otp/",
  "/forget-password",
  "/request-password-reset",
  "/reset-password",
  "/verify-email",
  "/send-verification-email",
  "/change-password",
  "/update-user",
  "/list-sessions",
  "/revoke-session",
  "/revoke-other-sessions",
  "/ok",
  "/error",
];

function openWhileSettingUp(path: string): boolean {
  return OPEN_WHILE_SETTING_UP.some((open) => path.startsWith(open));
}

/**
 * Runs in Better Auth's before hook while the setting is on. Throws for
 * turning two-factor off, and for anything else an account that must set it
 * up tries first. `loadSession` only runs for paths that need it.
 */
export async function enforceTwoFactorRequirement(
  path: string,
  loadSession: () => Promise<{ user: PolicyUser } | null>,
): Promise<void> {
  if (path === "/two-factor/disable") {
    throw new APIError("FORBIDDEN", {
      code: "TWO_FACTOR_LOCKED",
      message:
        "This server requires two-factor authentication, so it can't be turned off. An instance admin can reset it.",
    });
  }
  if (openWhileSettingUp(path)) return;
  const session = await loadSession();
  if (session?.user && (await mustSetUpTwoFactor(session.user))) {
    throw new APIError("FORBIDDEN", twoFactorRequiredBody);
  }
}
