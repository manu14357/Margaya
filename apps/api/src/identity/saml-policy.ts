import { APIError, isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import db from "../database";
import { ssoProviderTable } from "../database/schema";
import { getInstanceSettings } from "../instance-settings/snapshot";
import { emailDomainOf } from "../utils/email-domains";
import { requiredProviderName } from "../utils/sign-in-policy";

// The rules around Better Auth's SSO and SCIM plugins that aren't about one
// request's data. Connections are managed only through the instance admin routes
// (identity/index.ts), so the plugins' own management endpoints stay closed: left
// open they would let any signed-in user register an identity provider or mint a
// provisioning token. Allow-lists, so a route a later release adds stays closed
// too.

const SAML_ACS_PREFIX = "/sso/saml2/sp/acs/";

export const isSamlAcsPath = (path: string | undefined) =>
  path?.startsWith(SAML_ACS_PREFIX) === true;

export const isScimApiPath = (path: string | undefined) =>
  path?.startsWith("/scim/v2/") === true;

export function isClosedIdentityPath(path: string): boolean {
  if (path.startsWith("/scim/")) return !isScimApiPath(path);
  if (path.startsWith("/sso/")) {
    return !isSamlAcsPath(path) && path !== "/sso/saml2/sp/metadata";
  }
  return false;
}

/** With a required provider, everyone signs in through that, so not SAML. */
export function assertSamlSignInAllowed() {
  const required = getInstanceSettings().effective.requiredProvider;
  if (required) {
    throw new APIError("FORBIDDEN", {
      message: `Sign in with ${requiredProviderName(required)}.`,
    });
  }
}

/** Exact domain or a subdomain of it, as the plugin itself matches domains. */
export function emailInDomains(email: string, domains: string): boolean {
  const domain = emailDomainOf(email);
  if (!domain) return false;
  return domains
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

/**
 * An identity provider may only create accounts on the domains an instance admin
 * connected it for. Without this, one trusted for acme.example could mint an
 * account for ceo@other.example.
 */
export async function assertSamlEmailInDomain(
  email: string,
  providerId: string | undefined,
) {
  const [connection] = providerId
    ? await db
        .select({ domain: ssoProviderTable.domain })
        .from(ssoProviderTable)
        .where(eq(ssoProviderTable.providerId, providerId))
        .limit(1)
    : [];
  if (!connection || !emailInDomains(email, connection.domain)) {
    throw new APIError("FORBIDDEN", {
      code: "SAML_EMAIL_DOMAIN_MISMATCH",
      // The sign-in screen words the refusal from this text (auth.signIn.errors).
      message: "This identity provider cannot sign in that email address.",
    });
  }
}

/** Whether the sign-in screen offers SAML. Never fails the config it's part of. */
export async function samlSignInAvailable(): Promise<boolean> {
  if (getInstanceSettings().effective.requiredProvider) return false;
  try {
    const [row] = await db
      .select({ id: ssoProviderTable.id })
      .from(ssoProviderTable)
      .limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}

// The plugin's codes for a response it couldn't accept: saml_error for a bad
// signature, an expired or altered response and most else, and a few saml_* or
// assertion codes from its own checks. The sign-in screen has words for none of
// them, and showed "saml error", so they all read as one.
const UNACCEPTABLE_RESPONSE = /^(saml_\w+|multiple_assertions|no_assertion)$/;

/**
 * The plugin sends a refused sign-in to the page the person was heading for,
 * which bounces a signed-out visitor to sign-in with the reason lost. Returns
 * where to send them instead, with only the error code (the sign-in screen
 * words it), or null when the response isn't a refusal.
 */
export function samlFailureRedirect(
  location: string | null | undefined,
  clientUrl: string,
): string | null {
  if (!location) return null;
  let error: string | null;
  try {
    error = new URL(location, clientUrl).searchParams.get("error");
  } catch {
    return null;
  }
  if (!error) return null;
  if (UNACCEPTABLE_RESPONSE.test(error)) error = "invalid_saml_response";
  return `${clientUrl.replace(/\/$/, "")}/auth/sign-in?error=${encodeURIComponent(error)}`;
}

/**
 * The plugin turns only its 400s into redirects. Anything else it refuses with,
 * such as the 404 for a connection removed while the person was at the provider,
 * would reach the browser as bare JSON. Returns the sign-in screen to send them
 * to instead, or null when the answer isn't such an error.
 */
export function samlErrorRedirect(
  returned: unknown,
  clientUrl: string,
): string | null {
  if (!isAPIError(returned) || returned.statusCode < 400) return null;
  return `${clientUrl.replace(/\/$/, "")}/auth/sign-in?error=invalid_saml_response`;
}
