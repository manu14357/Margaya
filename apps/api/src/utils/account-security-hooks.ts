import { APIError } from "better-auth/api";
import { and, eq, ne } from "drizzle-orm";
import db from "../database";
import {
  pushSubscriptionTable,
  sessionTable,
  userTable,
  verificationTable,
} from "../database/schema";
import { recordInstanceAudit } from "../instance-admin/audit";
import {
  instanceAuditForAdminPath,
  isAdminMutationPath,
} from "../instance-admin/auth-admin-paths";
import { hasRecentAuth, reauthRequiredBody } from "../instance-admin/reauth";
import { instanceAdminApiKeysAllowed } from "./admin-api-keys";
import { checkNewPassword } from "./password-policy";

// Account-security rules applied in Better Auth's hooks (auth.ts):
// - the password policy on every path that sets a new password;
// - the Better Auth admin endpoints: never through an API key (unless
//   ALLOW_INSTANCE_ADMIN_API_KEYS=true), changes need a recent sign-in and
//   are written to the instance audit trail;
// - the email change: guests can't, and afterwards the old address is told
//   and other sessions end;
// - push devices end with the sessions, so a lost device stops showing alerts.
//   They have no link to a session, so all of them go, and the browser that
//   stays signed in puts itself back (withPushKeptOnThisDevice in the web app).

export const EMAIL_CHANGE_PATHS = new Set([
  "/email-otp/request-email-change",
  "/email-otp/change-email",
]);

type HookSession = {
  user: { id: string; email: string; role?: string | null } & Record<
    string,
    unknown
  >;
  session: { id: string; createdAt: Date | string };
};

export type BeforeHookContext = {
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Headers;
  context: object;
};

type LoadSession = () => Promise<HookSession | null>;

// The address before a change, from the before hook to the after hook (the
// same Better Auth context object runs through both).
const previousEmail = new WeakMap<object, string>();

async function emailOfUser(userId: unknown): Promise<string | null> {
  if (typeof userId !== "string" || !userId) return null;
  const [row] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.email ?? null;
}

async function userOfResetToken(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !token) return null;
  const [row] = await db
    .select({ value: verificationTable.value })
    .from(verificationTable)
    .where(eq(verificationTable.identifier, `reset-password:${token}`))
    .limit(1);
  return row?.value ?? null;
}

async function emailForResetToken(token: unknown): Promise<string | null> {
  return emailOfUser(await userOfResetToken(token));
}

async function userOfEmail(email: unknown): Promise<string | null> {
  if (typeof email !== "string" || !email) return null;
  const [row] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function removePushDevices(userId: string) {
  await db
    .delete(pushSubscriptionTable)
    .where(eq(pushSubscriptionTable.userId, userId));
}

// Who a password reset is for: the token and code are spent by the time the
// after hook runs, so the before hook finds them (same context object).
const passwordResetUser = new WeakMap<object, string>();

/** The account whose every other session a successful request has just ended. */
function userWhoseSessionsEnded(ctx: AfterHookContext): string | null {
  const body = ctx.body ?? {};
  const self = ctx.context.session?.user.id ?? null;
  switch (ctx.path) {
    case "/reset-password":
    case "/email-otp/reset-password":
      return passwordResetUser.get(ctx.context) ?? null;
    case "/change-password":
      return body.revokeOtherSessions === true ? self : null;
    case "/revoke-sessions":
    case "/revoke-other-sessions":
      return self;
    case "/admin/ban-user":
    case "/admin/revoke-user-sessions":
      return typeof body.userId === "string" ? body.userId : null;
    default:
      return null;
  }
}

/** Better Auth reads the reset token from the body or the query string. */
function resetTokenOf(ctx: BeforeHookContext): unknown {
  return ctx.body?.token ?? ctx.query?.token;
}

/** The new password a request sets, and the account email when known. */
async function newPasswordOf(
  ctx: BeforeHookContext,
  loadSession: LoadSession,
): Promise<{ password: string; email: string | null } | null> {
  const body = ctx.body ?? {};
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  switch (ctx.path) {
    case "/sign-up/email":
    case "/email-otp/reset-password":
    case "/admin/create-user": {
      const password = text(body.password);
      return password === null ? null : { password, email: text(body.email) };
    }
    case "/reset-password": {
      const password = text(body.newPassword);
      return password === null
        ? null
        : { password, email: await emailForResetToken(resetTokenOf(ctx)) };
    }
    case "/change-password": {
      const password = text(body.newPassword);
      if (password === null) return null;
      const session = await loadSession();
      return { password, email: session?.user.email ?? null };
    }
    case "/admin/set-user-password": {
      const password = text(body.newPassword);
      return password === null
        ? null
        : { password, email: await emailOfUser(body.userId) };
    }
    default:
      return null;
  }
}

/** Runs first in the before hook; throws an APIError to refuse. */
export async function enforceAccountSecurityRules(
  ctx: BeforeHookContext,
  loadSession: LoadSession,
): Promise<void> {
  const resetFor =
    ctx.path === "/reset-password"
      ? await userOfResetToken(resetTokenOf(ctx))
      : ctx.path === "/email-otp/reset-password"
        ? await userOfEmail(ctx.body?.email)
        : null;
  if (resetFor) passwordResetUser.set(ctx.context, resetFor);

  const candidate = await newPasswordOf(ctx, loadSession);
  if (candidate) {
    const violation = checkNewPassword(candidate.password, {
      email: candidate.email,
    });
    if (violation) {
      throw new APIError("BAD_REQUEST", {
        message: violation.message,
        code: violation.code,
      });
    }
  }

  if (ctx.path.startsWith("/admin/")) {
    if (ctx.headers?.get("x-api-key") && !instanceAdminApiKeysAllowed()) {
      throw new APIError("FORBIDDEN", {
        message:
          "API keys can't use the admin endpoints. Sign in, or set ALLOW_INSTANCE_ADMIN_API_KEYS=true.",
      });
    }
    if (isAdminMutationPath(ctx.path)) {
      const session = await loadSession();
      // Anyone but an admin keeps Better Auth's own refusal.
      if (
        session?.user.role?.split(",").includes("admin") &&
        !(await hasRecentAuth(session.session))
      ) {
        throw new APIError("FORBIDDEN", reauthRequiredBody);
      }
    }
  }

  if (EMAIL_CHANGE_PATHS.has(ctx.path)) {
    const session = await loadSession();
    if (session?.user.isAnonymous === true) {
      throw new APIError("FORBIDDEN", {
        message: "Guest accounts can't change their email address.",
      });
    }
    if (ctx.path === "/email-otp/change-email" && session) {
      previousEmail.set(ctx.context, session.user.email);
    }
  }
}

export type AfterHookContext = {
  path: string;
  body?: Record<string, unknown>;
  context: {
    returned?: unknown;
    newSession?: {
      user: { id: string; email: string };
      session: { id: string };
    } | null;
    session?: { user: { id: string } } | null;
  };
};

export type EmailChangedNotice = (input: {
  previousEmail: string;
  newEmail: string;
  userId: string;
}) => Promise<void>;

function masked(email: string) {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Runs in the after hook; never throws. */
export async function afterAccountSecurityRules(
  ctx: AfterHookContext,
  notifyEmailChanged: EmailChangedNotice,
): Promise<void> {
  const returned = ctx.context.returned;
  const failed =
    returned instanceof Error ||
    (returned instanceof Response && returned.status >= 400);
  if (failed) return;

  try {
    const sessionsEndedFor = userWhoseSessionsEnded(ctx);
    if (sessionsEndedFor) await removePushDevices(sessionsEndedFor);

    const audit = instanceAuditForAdminPath(ctx.path, ctx.body);
    if (audit) {
      const actorId = ctx.context.session?.user.id ?? null;
      let label = audit.target?.label ?? null;
      if (!label && audit.target?.id) {
        label = await emailOfUser(audit.target.id);
      }
      await recordInstanceAudit({
        ...audit,
        target: audit.target ? { ...audit.target, label } : null,
        actor: { userId: actorId },
      });
    }

    if (ctx.path === "/email-otp/change-email") {
      const before = previousEmail.get(ctx.context);
      const next = ctx.context.newSession;
      if (before && next && before !== next.user.email) {
        // The new address is proven; whoever held the old one is signed out.
        await db
          .delete(sessionTable)
          .where(
            and(
              eq(sessionTable.userId, next.user.id),
              ne(sessionTable.id, next.session.id),
            ),
          );
        await removePushDevices(next.user.id);
        await notifyEmailChanged({
          previousEmail: before,
          newEmail: masked(next.user.email),
          userId: next.user.id,
        });
      }
    }
  } catch (error) {
    console.error("Account security follow-up failed", error);
  }
}
