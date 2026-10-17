import { APIError } from "better-auth/api";
import { getInstanceSettings } from "../instance-settings/snapshot";
import {
  checkRegistrationAllowed,
  findValidInvitation,
} from "./check-registration-allowed";
import { emailDomainAllowed } from "./email-domains";
import { hasRegisteredUsers } from "./instance-bootstrap";

export function normalizeInvitationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[a-z0-9_-]{1,128}$/i.test(normalized) ? normalized : undefined;
}

export function isOAuthCallbackPath(path: unknown): boolean {
  return (
    typeof path === "string" &&
    (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/"))
  );
}

/**
 * With password sign-up off, a local account may still be created for a
 * valid invitation when the panel allows it: named by id, or matched by a
 * verified address (email codes and links).
 */
async function invitedLocalSignUp(
  user: { email: string; emailVerified?: boolean },
  invitationId: unknown,
  verifiedEmailFlow: boolean,
): Promise<boolean> {
  if (!getInstanceSettings().effective.emailSignUpForInvitations) return false;
  const id = normalizeInvitationId(invitationId);
  if (!id && !(verifiedEmailFlow && user.emailVerified === true)) return false;
  return Boolean(await findValidInvitation(user.email, id));
}

/**
 * Password sign-up while emailSignUp is off: allowed only when the panel
 * keeps it for invitations and the request names a valid invitation for the
 * same address.
 */
export async function invitedPasswordSignUpAllowed(
  body: Record<string, unknown> | undefined,
  headers: Headers | undefined,
): Promise<boolean> {
  if (!getInstanceSettings().effective.emailSignUpForInvitations) return false;
  const email = typeof body?.email === "string" ? body.email : "";
  const invitationId = normalizeInvitationId(
    body?.invitationId ?? headers?.get("x-invitation-id"),
  );
  if (!email || !invitationId) return false;
  return Boolean(await findValidInvitation(email, invitationId));
}

export async function assertGuestRegistrationAllowed(): Promise<void> {
  if (
    !getInstanceSettings().derived.guestAccessActive ||
    !(await hasRegisteredUsers())
  ) {
    throw new APIError("FORBIDDEN", {
      message: "Guest access is unavailable on this instance.",
    });
  }
}

export async function assertUserRegistrationAllowed(
  user: {
    email: string;
    emailVerified?: boolean;
    isAnonymous?: boolean | null;
  },
  context?: { path?: string; invitationId?: unknown },
): Promise<void> {
  if (user.isAnonymous) {
    await assertGuestRegistrationAllowed();
    return;
  }
  if (!(await hasRegisteredUsers())) return;
  const { effective } = getInstanceSettings();
  if (!emailDomainAllowed(user.email, effective.allowedEmailDomains)) {
    throw new APIError("FORBIDDEN", {
      message: "New accounts on this server must use an approved email domain.",
    });
  }
  const verifiedEmailFlow =
    isOAuthCallbackPath(context?.path) ||
    context?.path === "/sign-in/email-otp" ||
    context?.path === "/magic-link/verify";
  if (
    !effective.emailSignUp &&
    !isOAuthCallbackPath(context?.path) &&
    !(await invitedLocalSignUp(user, context?.invitationId, verifiedEmailFlow))
  ) {
    throw new APIError("FORBIDDEN", {
      message:
        "Local account registration is disabled. Please use a configured social or OIDC sign-in method.",
    });
  }
  const result = await checkRegistrationAllowed(
    user.email,
    normalizeInvitationId(context?.invitationId),
    {
      allowInvitationByEmail: verifiedEmailFlow,
      emailVerified: user.emailVerified === true,
    },
  );
  if (!result.allowed)
    throw new APIError("FORBIDDEN", { message: result.reason });
}
