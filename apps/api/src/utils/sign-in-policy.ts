import bcrypt from "bcryptjs";
import { APIError } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { OAuthProviderId } from "../instance-settings/resolve";
import { getInstanceSettings } from "../instance-settings/snapshot";
import { emailDomainAllowed } from "./email-domains";
import { hasRegisteredUsers } from "./instance-bootstrap";

// The instance sign-in policy, run in Better Auth's before hook:
// - a required provider: everyone signs in through it, except instance
//   admins, who keep password sign-in (and its reset) as a way back in;
// - allowed email domains also limit who can be invited;
// - accounts with two-factor on can't use email links or codes, which would
//   skip the second step.
// Requests that would only send an email answer exactly like a sent one, so
// the policy never tells a stranger whether an address is an admin or uses
// two-factor.

const DAY_SECONDS = 24 * 60 * 60;

/** Better Auth session timing for a lifetime in hours. */
export function sessionTimingOf(hours: number) {
  const expiresIn = Math.max(1, Math.floor(hours)) * 60 * 60;
  // Activity extends a session at most daily, and well before a short
  // lifetime runs out.
  const updateAge = Math.min(
    DAY_SECONDS,
    Math.max(60, Math.floor(expiresIn / 4)),
  );
  return { expiresIn, updateAge };
}

const PROVIDER_NAMES: Record<OAuthProviderId, string> = {
  github: "GitHub",
  google: "Google",
  discord: "Discord",
  custom: "your organization's sign-in",
};

export function requiredProviderName(provider: OAuthProviderId): string {
  if (provider === "custom") {
    const label = getInstanceSettings().effective.customOAuth.buttonLabel;
    if (label) return label;
  }
  return PROVIDER_NAMES[provider];
}

type Account = {
  id: string;
  role: string | null;
  banned: boolean | null;
  twoFactorEnabled: boolean | null;
};

async function accountByEmail(email: unknown): Promise<Account | null> {
  if (typeof email !== "string" || !email.trim()) return null;
  const [row] = await db
    .select({
      id: schema.userTable.id,
      role: schema.userTable.role,
      banned: schema.userTable.banned,
      twoFactorEnabled: schema.userTable.twoFactorEnabled,
    })
    .from(schema.userTable)
    .where(
      sql`lower(${schema.userTable.email}) = ${email.trim().toLowerCase()}`,
    )
    .limit(1);
  return row ?? null;
}

function isAdmin(account: Account | null): boolean {
  return account?.role === "admin" && account.banned !== true;
}

async function passwordMatches(userId: string, password: unknown) {
  if (typeof password !== "string" || !password) return false;
  const [credential] = await db
    .select({ password: schema.accountTable.password })
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.userId, userId),
        eq(schema.accountTable.providerId, "credential"),
      ),
    )
    .limit(1);
  return credential?.password
    ? bcrypt.compare(password, credential.password)
    : false;
}

const sent = () => Response.json({ success: true });
const resetSent = () =>
  Response.json({
    status: true,
    message:
      "If this email exists in our system, check your email for the reset link",
  });

/** The reply of an email-sending path, or null for other paths. */
function sendingReply(
  path: string,
  body: Record<string, unknown> | undefined,
): (() => Response) | null {
  if (path === "/sign-in/magic-link") {
    return () => Response.json({ status: true });
  }
  if (path === "/email-otp/send-verification-otp") {
    return body?.type === "sign-in" || body?.type === "forget-password"
      ? sent
      : null;
  }
  if (
    path === "/forget-password/email-otp" ||
    path === "/email-otp/request-password-reset"
  ) {
    return sent;
  }
  if (path === "/request-password-reset") return resetSent;
  return null;
}

/** Sends that start an email sign-in (not a password reset). */
function startsEmailSignIn(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return (
    path === "/sign-in/magic-link" ||
    (path === "/email-otp/send-verification-otp" && body?.type === "sign-in")
  );
}

function invalidCode(): APIError {
  return new APIError("BAD_REQUEST", {
    message: "Invalid OTP",
    code: "INVALID_OTP",
  });
}

type PolicyInput = {
  path: string;
  body: Record<string, unknown> | undefined;
  /** The OAuth provider the request starts or completes, if any. */
  provider: OAuthProviderId | null;
  /** Verifying or changing the signed-in user's own address. */
  accountEmailRequest: boolean;
};

/**
 * Throws an APIError for a refused request, returns a Response that looks
 * like success for an email that must not go out, or null to continue.
 */
export async function enforceSignInPolicy({
  path,
  body,
  provider,
  accountEmailRequest,
}: PolicyInput): Promise<Response | null> {
  const { effective } = getInstanceSettings();

  if (path === "/organization/invite-member") {
    await assertInviteeDomain(body?.email, effective.allowedEmailDomains);
    return null;
  }
  if (accountEmailRequest) return null;

  const required = effective.requiredProvider;
  if (required) {
    if (provider && provider !== required) {
      throw new APIError("FORBIDDEN", {
        message: `Sign in with ${requiredProviderName(required)}.`,
      });
    }
    if (path === "/sign-up/email" && (await hasRegisteredUsers())) {
      throw new APIError("FORBIDDEN", {
        message: `Sign up with ${requiredProviderName(required)}.`,
      });
    }
    const reply = sendingReply(path, body);
    if (reply) {
      const account = await accountByEmail(body?.email);
      if (!isAdmin(account)) return reply();
    }
    if (path === "/sign-in/email-otp" || path === "/email-otp/reset-password") {
      if (!isAdmin(await accountByEmail(body?.email))) throw invalidCode();
    }
    if (path === "/sign-in/email") {
      // Only a correct password learns that the account must use the
      // provider; a wrong one gets Better Auth's usual answer.
      const account = await accountByEmail(body?.email);
      if (
        account &&
        !isAdmin(account) &&
        (await passwordMatches(account.id, body?.password))
      ) {
        throw new APIError("FORBIDDEN", {
          message: `Sign in with ${requiredProviderName(required)}.`,
        });
      }
    }
  }

  if (startsEmailSignIn(path, body)) {
    const account = await accountByEmail(body?.email);
    if (account?.twoFactorEnabled) {
      const reply = sendingReply(path, body);
      if (reply) return reply();
    }
  }
  if (path === "/sign-in/email-otp") {
    const account = await accountByEmail(body?.email);
    if (account?.twoFactorEnabled) throw invalidCode();
  }
  return null;
}

/**
 * With allowed domains set, a new address outside them can't be invited:
 * it could never sign up. People who already have an account can.
 */
async function assertInviteeDomain(email: unknown, allowed: string[]) {
  if (allowed.length === 0 || typeof email !== "string") return;
  if (emailDomainAllowed(email, allowed)) return;
  if (await accountByEmail(email)) return;
  throw new APIError("BAD_REQUEST", {
    message:
      "This server only accepts new accounts from approved email domains.",
  });
}
