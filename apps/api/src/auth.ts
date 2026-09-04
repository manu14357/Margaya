import { apiKey } from "@better-auth/api-key";
import {
  OTP_EXPIRY_SECONDS,
  sendMagicLinkEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendWorkspaceInvitationEmail,
} from "@margaya/email";
import {
  ac,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  owner,
} from "@margaya/permissions";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  admin as adminPlugin,
  anonymous,
  bearer,
  deviceAuthorization,
  emailOTP,
  genericOAuth,
  lastLoginMethod,
  magicLink,
  openAPI,
  organization,
} from "better-auth/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import type { UserWithAnonymous } from "better-auth/plugins/anonymous";
import { config } from "dotenv-mono";
import { eq } from "drizzle-orm";
import {
  findBillableWorkspaces,
  formatBillableWorkspacesMessage,
} from "./billing/controllers/find-billable-workspaces";
import { syncWorkspaceSeats } from "./billing/controllers/sync-seats";
import db, { schema } from "./database";
import { publishEvent } from "./events";
import type {
  OAuthBuildConfig,
  OAuthProviderId,
} from "./instance-settings/resolve";
import { getInstanceSettings } from "./instance-settings/snapshot";
import { clearMemberProjectRoles } from "./project/people";
import { purgeWorkspaceExports } from "./task-export/storage";
import deleteAccountData from "./user/controllers/delete-account-data";
import { authRateLimitConfig } from "./utils/auth-rate-limit";
import { resolveAuthSecret } from "./utils/auth-secret";
import { checkRegistrationAllowed } from "./utils/check-registration-allowed";
import { checkWorkspaceName } from "./utils/check-workspace-name";
import { mapCustomOAuthProfileToUser } from "./utils/custom-oauth-profile";
import { generateDemoName } from "./utils/generate-demo-name";
import { getDefaultCookieAttributes } from "./utils/get-default-cookie-attributes";
import { getInvitationEmailSubject } from "./utils/get-invitation-email-subject";
import { getWorkspaceInvitationEmailCopy } from "./utils/get-workspace-invitation-email-copy";
import { isLastInstanceAdmin } from "./utils/instance-admins";
import {
  hasRegisteredUsers,
  promoteInitialAdministrator,
} from "./utils/instance-bootstrap";
import { isCloud } from "./utils/is-cloud";
import { isDisposableEmail } from "./utils/is-disposable-email";
import { isLocalSignInPath } from "./utils/is-local-sign-in-path";
import {
  assertGuestRegistrationAllowed,
  assertUserRegistrationAllowed,
  normalizeInvitationId,
} from "./utils/registration-policy";
import { authCaptchaPaths, verifyTurnstile } from "./utils/verify-turnstile";
import { afterWorkspaceMemberRemoved } from "./utils/workspace-member-removed";

config();

/** A former member stops being lead or default assignee of any project. */
async function clearProjectRolesAfterRemoval(
  workspaceId: string,
  userId: string,
) {
  await clearMemberProjectRoles(workspaceId, userId).catch((error) => {
    console.error("Project role cleanup after member removal failed:", error);
  });
}

// The plugin shape follows the environment at startup, exactly as before
// instance settings existed (D20). A variable that turns a plugin off also
// locks its setting for the life of the process, so the panel can never need
// the missing plugin; disabled paths keep Better Auth's own 404.
const guestPluginRegistered = process.env.DISABLE_GUEST_ACCESS !== "true";
// The email-code plugin is always registered because email verification
// needs it. When the environment turns code sign-in off, its sign-in paths
// still answer exactly like unregistered endpoints (see the before hook).
const emailCodeSignInOffAtStartup =
  process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true";
const localSignUpDisabledAtStartup =
  process.env.DISABLE_PASSWORD_REGISTRATION === "true";

const apiUrl = process.env.MARGAYA_API_URL || "http://localhost:1337";
const clientUrl = process.env.MARGAYA_CLIENT_URL || "http://localhost:5173";

const trustedOrigins = [clientUrl];
try {
  const apiOrigin = new URL(apiUrl);
  const apiOriginString = `${apiOrigin.protocol}//${apiOrigin.host}`;
  if (!trustedOrigins.includes(apiOriginString)) {
    trustedOrigins.push(apiOriginString);
  }
} catch {}

const baseURLWithoutPath = (() => {
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/"); // Get protocol://host
  }
})();

const authSecret = (() => {
  try {
    return resolveAuthSecret();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();

async function getUserLocale(email: string) {
  const [user] = await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);

  return user?.locale ?? null;
}

function getLocaleKey(locale?: string | null) {
  const normalized = locale?.toLowerCase();
  if (normalized?.startsWith("de")) return "de";
  if (normalized?.startsWith("vi")) return "vi";
  if (normalized?.startsWith("ja")) return "ja";
  return "en";
}

function getAuthEmailCopy(locale?: string | null) {
  const localeKey = getLocaleKey(locale);

  if (localeKey === "de") {
    return {
      magicLinkSubject: "Anmeldelink für Margaya",
      otpSubject: "Bestätigungscode für Margaya",
      verifyEmailSubject: "Bestätige deine E-Mail-Adresse für Margaya",
      passwordResetSubject: "Setze dein Margaya-Passwort zurück",
    };
  }

  if (localeKey === "vi") {
    return {
      magicLinkSubject: "Liên kết đăng nhập Margaya",
      otpSubject: "Mã xác minh Margaya",
      verifyEmailSubject: "Xác minh email của bạn cho Margaya",
      passwordResetSubject: "Đặt lại mật khẩu Margaya của bạn",
    };
  }

  if (localeKey === "ja") {
    return {
      magicLinkSubject: "Margaya ログインリンク",
      otpSubject: "Margaya 認証コード",
      verifyEmailSubject: "Margaya メールアドレスの確認",
      passwordResetSubject: "Margaya パスワードのリセット",
    };
  }

  return {
    magicLinkSubject: "Login for Margaya",
    otpSubject: "Authentication code for Margaya",
    verifyEmailSubject: "Verify your email for Margaya",
    passwordResetSubject: "Reset your Margaya password",
  };
}

function getDeviceAuthClientIds(): Set<string> {
  const raw = process.env.DEVICE_AUTH_CLIENT_IDS?.trim();
  if (raw) {
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return new Set(["margaya-cli", "margaya-mcp"]);
}

function getDeviceAuthVerificationUri(): string {
  const base = clientUrl.replace(/\/$/, "");
  return `${base}/device`;
}

function isEmailCodePath(path: string) {
  return (
    path.startsWith("/email-otp/") ||
    path === "/sign-in/email-otp" ||
    path === "/forget-password/email-otp"
  );
}

/** Verifying the signed-in user's own address, not signing in with a code. */
function isEmailVerificationRequest(
  path: string,
  body: Record<string, unknown> | undefined,
) {
  return (
    path === "/email-otp/verify-email" ||
    (path === "/email-otp/send-verification-otp" &&
      body?.type === "email-verification")
  );
}

/** What Better Auth answers for a path no plugin registered. */
function unregisteredEndpointResponse() {
  return new Response(null, { status: 404, statusText: "Not Found" });
}

const SOCIAL_PROVIDERS = new Set<OAuthProviderId>([
  "github",
  "google",
  "discord",
]);

/** The sign-in provider a Better Auth request starts or completes, if any. */
function requestedOAuthProvider(
  path: string,
  body: Record<string, unknown> | undefined,
): OAuthProviderId | null {
  let id: unknown = null;
  if (path === "/sign-in/social" || path === "/link-social")
    id = body?.provider;
  else if (path === "/sign-in/oauth2") id = body?.providerId;
  else if (path.startsWith("/callback/")) id = path.slice("/callback/".length);
  else if (path.startsWith("/oauth2/callback/"))
    id = path.slice("/oauth2/callback/".length);
  if (id === "custom") return "custom";
  return typeof id === "string" && SOCIAL_PROVIDERS.has(id as OAuthProviderId)
    ? (id as OAuthProviderId)
    : null;
}

const ADMIN_DEMOTION_PATHS = new Set([
  "/admin/set-role",
  "/admin/remove-user",
  "/admin/ban-user",
]);

/** Refuses (409) demoting, removing or banning the last instance admin. */
async function assertKeepsAnInstanceAdmin(ctx: {
  path: string;
  body?: Record<string, unknown>;
}) {
  const targetId = ctx.body?.userId;
  if (typeof targetId !== "string") return;
  if (ctx.path === "/admin/set-role") {
    const roles = ([] as unknown[]).concat(ctx.body?.role ?? []);
    const keepsAdmin = roles.some(
      (role) => typeof role === "string" && role.split(",").includes("admin"),
    );
    if (keepsAdmin) return;
  }
  if (await isLastInstanceAdmin(targetId)) {
    throw new APIError("CONFLICT", {
      message: "There must be at least one instance admin",
    });
  }
}

/**
 * Builds a Better Auth instance. Only the OAuth credentials and endpoints
 * come from the arguments; every switch is read per request in the hooks.
 */
function createAuthInstance(oauth: OAuthBuildConfig) {
  return betterAuth({
    baseURL: baseURLWithoutPath,
    trustedOrigins,
    secret: authSecret,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        ...schema,
        user: schema.userTable,
        account: schema.accountTable,
        session: schema.sessionTable,
        verification: schema.verificationTable,
        workspace: schema.workspaceTable,
        workspace_member: schema.workspaceUserTable,
        invitation: schema.invitationTable,
        workspace_role: schema.workspaceRoleTable,
        team: schema.teamTable,
        teamMember: schema.teamMemberTable,
        apikey: schema.apikeyTable,
        deviceCode: schema.deviceCodeTable,
      },
    }),
    user: {
      additionalFields: {
        locale: {
          type: "string",
          input: true,
          required: false,
        },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          await deleteAccountData(user.id);
        },
      },
    },
    account: {
      accountLinking: {
        // Require the provider's verified-email claim for implicit linking;
        // configuration alone must not make an unverified identity trusted.
        enabled: true,
        // Only link to an existing local account after its email has been
        // verified. Without this check, an attacker could pre-register a victim's
        // email with a password account and retain access after the victim signs
        // in through a trusted OAuth/OIDC provider.
        requireLocalEmailVerified: true,
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // The reset email says the link lasts an hour.
      resetPasswordTokenExpiresIn: 60 * 60,
      // Whoever had the old password loses every session it opened.
      revokeSessionsOnPasswordReset: true,
      // The answer is the same whether or not the account exists, and the
      // link goes straight to the web app's reset screen.
      sendResetPassword: async ({ user, token }) => {
        if (!getInstanceSettings().derived.smtpConfigured) {
          console.warn("Password reset requested but SMTP is not configured");
          return;
        }
        try {
          const locale = await getUserLocale(user.email);
          const copy = getAuthEmailCopy(locale);
          const resetLink = `${clientUrl.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
          await sendPasswordResetEmail(user.email, copy.passwordResetSubject, {
            resetLink,
            userName: user.name || undefined,
            locale,
          });
        } catch (error) {
          console.error("Failed to send the password reset email", error);
        }
      },
      password: {
        hash: async (password) => {
          return await bcrypt.hash(password, 10);
        },
        verify: async ({ hash, password }) => {
          return await bcrypt.compare(password, hash);
        },
      },
    },
    socialProviders: {
      github: {
        clientId: oauth.github.clientId,
        clientSecret: oauth.github.clientSecret,
        scope: ["user:email"],
      },
      google: {
        clientId: oauth.google.clientId,
        clientSecret: oauth.google.clientSecret,
      },
      discord: {
        clientId: oauth.discord.clientId,
        clientSecret: oauth.discord.clientSecret,
      },
    },
    // Switches that the panel can change are enforced per request in the
    // before hook and the user.create hook; the plugin shape itself is fixed
    // at startup (see `guestPluginRegistered`).
    plugins: [
      ...(guestPluginRegistered
        ? [
            anonymous({
              generateName: async () => generateDemoName(),
              emailDomainName: "margaya.app",
            }),
          ]
        : []),
      lastLoginMethod(),
      magicLink({
        disableSignUp: localSignUpDisabledAtStartup,
        sendMagicLink: async ({ email, url }) => {
          try {
            const locale = await getUserLocale(email);
            const copy = getAuthEmailCopy(locale);
            await sendMagicLinkEmail(email, copy.magicLinkSubject, {
              magicLink: url,
              locale,
            });
          } catch (error) {
            console.error(error);
          }
        },
      }),
      emailOTP({
        expiresIn: OTP_EXPIRY_SECONDS,
        disableSignUp: localSignUpDisabledAtStartup,
        async sendVerificationOTP({ email, otp, type }) {
          if (type === "sign-in") {
            const locale = await getUserLocale(email);
            const copy = getAuthEmailCopy(locale);
            await sendOtpEmail(email, copy.otpSubject, {
              otp,
              locale,
            });
          } else if (type === "email-verification") {
            const locale = await getUserLocale(email);
            const copy = getAuthEmailCopy(locale);
            await sendOtpEmail(email, copy.verifyEmailSubject, {
              otp,
              locale,
              purpose: "email-verification",
            });
          }
        },
      }),
      organization({
        // `ac` is created with a narrow `statement` shape (project/task/label/
        // workspace + the default org statements), which makes its inferred
        // `newRole` generic incompatible with better-auth's looser
        // `AccessControl` type. Widen via an explicit cast so the plugin
        // accepts our custom statement.
        ac: ac as unknown as AccessControl,
        // Only `owner` stays static so its permissions can never be edited away
        // from the workspace creator. `viewer`, `member`, and `admin` are
        // seeded into `workspace_role` per workspace and resolved via
        // dynamic access control, so admins can fully override (replace) their
        // permissions per workspace. See `seedDefaultWorkspaceRoles` + the
        // afterCreateOrganization hook.
        roles: { owner },
        dynamicAccessControl: {
          enabled: true,
          maximumRolesPerOrganization: 25,
        },
        teams: {
          enabled: true,
          maximumTeams: 10,
          allowRemovingAllTeams: false,
        },
        schema: {
          organization: {
            modelName: "workspace",
            additionalFields: {
              // in metadata
              description: {
                type: "string",
                input: true,
                required: false,
              },
            },
          },
          member: {
            modelName: "workspace_member",
            fields: {
              organizationId: "workspaceId",
              createdAt: "joinedAt",
            },
          },
          invitation: {
            modelName: "invitation",
            fields: {
              organizationId: "workspaceId",
            },
          },
          organizationRole: {
            modelName: "workspace_role",
            fields: {
              organizationId: "workspaceId",
            },
          },
          team: {
            modelName: "team",
            fields: {
              organizationId: "workspaceId",
            },
          },
        },
        // When workspace creation is restricted, only instance admins
        // (`user.role === "admin"`) may create workspaces — mirrors the
        // implicit-exemption shape of `DISABLE_REGISTRATION` above. This
        // check runs before any workspace membership exists, so only the
        // instance-wide role is meaningful here; per-workspace roles
        // (owner/admin/member/viewer) don't apply until after a workspace
        // is joined.
        //
        // `user` here comes from the session, which may be served out of
        // the cookie cache (see `session.cookieCache` below). The
        // first-user bootstrap promotes the user to admin in
        // `databaseHooks.user.create.after`, but that happens after
        // `signUpEmail` has already returned/cached the pre-promotion
        // role, so a cached session can still say `role: "user"` for up
        // to `cookieCache.maxAge`. Re-read the role from the database
        // instead of trusting the (possibly stale) cached role.
        allowUserToCreateOrganization: async (user) => {
          if (!getInstanceSettings().effective.restrictWorkspaceCreation) {
            return true;
          }
          const [freshUser] = await db
            .select({ role: schema.userTable.role })
            .from(schema.userTable)
            .where(eq(schema.userTable.id, user.id));
          return freshUser?.role === "admin";
        },
        // Better Auth defaults this to `true`, which blocks any user whose email
        // is not verified from accepting/rejecting an invitation. Margaya does
        // not verify emails on signup (and guest/anonymous users are
        // unverified by design), so leaving the default on breaks invitation
        // acceptance for everyone. The invitation link id is the actual secret
        // here, so gate on that rather than on email verification.
        requireEmailVerificationOnInvitation: false,
        organizationHooks: {
          beforeCreateOrganization: async ({ organization }) => {
            const check = checkWorkspaceName(organization.name ?? "");
            if (!check.ok) {
              throw new APIError("BAD_REQUEST", { message: check.reason });
            }
          },
          afterCreateOrganization: async ({ organization, user }) => {
            // Seed the editable default roles for this workspace. Each
            // role's permissions are derived from the compiled-in defaults
            // in `@margaya/permissions`; admins can later replace them in the
            // Roles UI. We skip names that somehow already exist (this hook
            // is best-effort idempotent; the boot-time backfill is the
            // belt-and-braces path).
            try {
              const existing = await db
                .select({ role: schema.workspaceRoleTable.role })
                .from(schema.workspaceRoleTable)
                .where(
                  eq(schema.workspaceRoleTable.workspaceId, organization.id),
                );
              const taken = new Set(existing.map((r) => r.role));
              const now = new Date();
              const rows = DEFAULT_ROLE_NAMES.filter(
                (name) => !taken.has(name),
              ).map((name) => ({
                workspaceId: organization.id,
                role: name,
                permission: JSON.stringify(defaultRolePayloads[name]),
                createdAt: now,
                updatedAt: now,
              }));
              if (rows.length > 0) {
                await db.insert(schema.workspaceRoleTable).values(rows);
              }
            } catch (error) {
              console.error(
                "Failed to seed default workspace roles for workspace",
                organization.id,
                error,
              );
            }

            publishEvent("workspace.created", {
              workspaceId: organization.id,
              workspaceName: organization.name,
              ownerEmail: user.name,
              ownerId: user.id,
            });
          },
          beforeDeleteOrganization: async ({ organization }) => {
            const billable = await findBillableWorkspaces([organization.id]);
            if (billable.length > 0) {
              throw new APIError("CONFLICT", {
                message: formatBillableWorkspacesMessage(
                  billable.map((workspace) => workspace.name),
                ),
              });
            }
            // Export rows cascade with the workspace; stored objects don't.
            await purgeWorkspaceExports(organization.id).catch((error) => {
              console.error(
                "Export cleanup before workspace delete failed",
                error,
              );
            });
          },
          afterAddMember: async ({ member }) => {
            if (member?.organizationId) {
              void syncWorkspaceSeats(member.organizationId).catch((error) => {
                console.error("Seat sync after member add failed:", error);
              });
            }
          },
          afterRemoveMember: async ({ member }) => {
            if (member?.organizationId && member.userId) {
              await clearProjectRolesAfterRemoval(
                member.organizationId,
                member.userId,
              );
            }
            if (member?.organizationId) {
              afterWorkspaceMemberRemoved(member.organizationId);
            }
          },
        },
        async sendInvitationEmail(data) {
          const inviteLink = `${process.env.MARGAYA_CLIENT_URL}/invitation/accept/${data.id}`;
          const locale = await getUserLocale(data.email);
          const copy = getWorkspaceInvitationEmailCopy(locale);

          const result = await sendWorkspaceInvitationEmail(
            data.email,
            getInvitationEmailSubject(
              locale,
              data.inviter.user.name,
              data.organization.name,
            ),
            {
              inviterEmail: data.inviter.user.email,
              inviterName: data.inviter.user.name,
              workspaceName: data.organization.name,
              invitationLink: inviteLink,
              to: data.email,
              copy,
            },
          );

          if (
            result?.success === false &&
            result.reason === "SMTP_NOT_CONFIGURED"
          ) {
            console.warn(
              "Invitation created but email not sent due to SMTP not being configured",
            );
            return;
          }
        },
      }),
      genericOAuth({
        config: [
          {
            providerId: "custom",
            clientId: oauth.custom.clientId,
            clientSecret: oauth.custom.clientSecret || undefined,
            authorizationUrl: oauth.custom.authorizationUrl,
            tokenUrl: oauth.custom.tokenUrl,
            userInfoUrl: oauth.custom.userInfoUrl,
            scopes: oauth.custom.scopes,
            responseType: oauth.custom.responseType,
            discoveryUrl: oauth.custom.discoveryUrl,
            pkce: oauth.custom.pkce,
            mapProfileToUser: mapCustomOAuthProfileToUser,
          },
        ],
      }),
      bearer(),
      apiKey({
        enableSessionForAPIKeys: true,
        apiKeyHeaders: "x-api-key",
        rateLimit: {
          enabled: true,
          maxRequests: 100,
          timeWindow: 60 * 1000,
        },
      }),
      deviceAuthorization({
        verificationUri: getDeviceAuthVerificationUri(),
        validateClient: async (clientId) =>
          getDeviceAuthClientIds().has(clientId),
      }),
      adminPlugin({
        defaultRole: "user",
        adminRoles: ["admin"],
      }),
      openAPI(),
    ],
    session: {
      // Off so that signing out, revoking a session or banning a user takes
      // effect on the next request. With the signed session_data cache on, a
      // copied cookie pair kept authorizing API calls (and Better Auth's own
      // organization routes) for up to its maxAge after sign-out. The cost is
      // one indexed session lookup (by unique token, joined to the user) per
      // authenticated request.
      cookieCache: {
        enabled: false,
      },
    },
    // On everywhere unless AUTH_RATE_LIMIT_ENABLED=false; counted in memory
    // per API instance. See utils/auth-rate-limit.ts for the rules.
    rateLimit: authRateLimitConfig(),
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            await assertUserRegistrationAllowed(
              user as Partial<UserWithAnonymous> & { email: string },
              {
                path: ctx?.path,
                invitationId:
                  ctx?.body?.invitationId ||
                  ctx?.query?.invitationId ||
                  ctx?.headers?.get("x-invitation-id"),
              },
            );
          },
          after: async (user) => {
            // The anonymous() plugin creates ephemeral users for guest
            // access; never promote one to instance admin even if no
            // real admin exists yet. `isAnonymous` is contributed by the
            // anonymous plugin's `additionalFields` and isn't part of the
            // base User type, so we narrow through `UserWithAnonymous`.
            const userWithAnonymous = user as Partial<UserWithAnonymous>;
            if (userWithAnonymous.isAnonymous) {
              return;
            }

            await promoteInitialAdministrator(user.id);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const { effective, derived } = getInstanceSettings();

        const verifyingEmail = isEmailVerificationRequest(ctx.path, ctx.body);
        if (
          emailCodeSignInOffAtStartup &&
          isEmailCodePath(ctx.path) &&
          !verifyingEmail
        ) {
          return unregisteredEndpointResponse();
        }

        // Codes for verifying an address go only to the signed-in user's own
        // address, so this path cannot mail codes to strangers.
        if (ctx.path === "/email-otp/send-verification-otp" && verifyingEmail) {
          const session = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          }).catch(() => null);
          const requested = String(ctx.body?.email ?? "").toLowerCase();
          if (
            !session?.user ||
            session.user.email.toLowerCase() !== requested
          ) {
            throw new APIError("FORBIDDEN", {
              message: "You can only verify your own email address.",
            });
          }
        }

        if (
          !effective.emailSignIn &&
          isLocalSignInPath(ctx.path) &&
          !verifyingEmail
        ) {
          throw new APIError("FORBIDDEN", {
            message:
              "Local sign-in is disabled. Please use a configured social or OIDC sign-in method.",
          });
        }

        if (
          !effective.emailCodeSignIn &&
          isEmailCodePath(ctx.path) &&
          !verifyingEmail
        ) {
          throw new APIError("FORBIDDEN", {
            message: "Email codes are turned off on this server.",
          });
        }

        if (ctx.path === "/sign-in/anonymous") {
          await assertGuestRegistrationAllowed();
        }

        // A provider an admin turned off in the panel. The switch has no
        // environment variable and defaults to on, so environment-only
        // deployments never reach this and keep Better Auth's own answers.
        const provider = requestedOAuthProvider(ctx.path, ctx.body);
        if (provider && !derived.providers[provider].enabled) {
          throw new APIError("FORBIDDEN", {
            message: "This sign-in method is turned off.",
          });
        }

        if (ADMIN_DEMOTION_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          }).catch(() => null);
          // Only an admin reaches these endpoints; anyone else keeps Better
          // Auth's own refusal.
          if ((session?.user as { role?: string | null })?.role === "admin") {
            await assertKeepsAnInstanceAdmin(ctx);
          }
        }

        // A signed-in user verifying their own address needs no CAPTCHA.
        if (authCaptchaPaths.has(ctx.path) && !verifyingEmail) {
          const verdict = await verifyTurnstile(
            ctx.headers?.get("x-turnstile-token") ?? ctx.body?.turnstileToken,
          );
          if (!verdict.ok)
            throw new APIError("FORBIDDEN", { message: verdict.reason });
        }

        // Block invite-member calls on cloud from anonymous users or to
        // disposable-email addresses. The 2026-05-28 incident saw ~14k phishing
        // invites sent from throwaway disposable-email signups; gating here
        // shuts that path off without affecting self-hosted instances.
        if (ctx.path === "/organization/invite-member" && isCloud()) {
          // `before` hooks don't auto-populate ctx.context.session; load it
          // explicitly. `disableRefresh` keeps this gate cheap: we only need
          // the user record, not a session refresh side-effect.
          const session = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          }).catch(() => null);
          const sessionUser = session?.user as
            | { isAnonymous?: boolean | null }
            | undefined;
          if (sessionUser?.isAnonymous) {
            throw new APIError("FORBIDDEN", {
              message: "Guest accounts may not send workspace invitations.",
            });
          }
          const inviteeEmail = (ctx.body?.email as string | undefined) ?? "";
          if (inviteeEmail && isDisposableEmail(inviteeEmail)) {
            throw new APIError("BAD_REQUEST", {
              message:
                "Invitations to disposable-email addresses are not allowed.",
            });
          }
        }

        const isSignUpPath =
          ctx.path === "/sign-up/email" ||
          ctx.path.startsWith("/callback/") ||
          ctx.path.startsWith("/sign-in/social");

        if (!isSignUpPath) {
          return;
        }

        const isInstanceAdminSetup = !(await hasRegisteredUsers());

        if (ctx.path === "/sign-up/email") {
          if (!effective.emailSignUp && !isInstanceAdminSetup) {
            throw new APIError("FORBIDDEN", {
              message:
                "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
            });
          }

          // Cloud-only disposable-email check; CAPTCHA is enforced above
          // on every account-creation initiation when configured.
          if (isCloud() && !isInstanceAdminSetup) {
            const signupEmail = (ctx.body?.email as string | undefined) ?? "";
            if (signupEmail && isDisposableEmail(signupEmail)) {
              throw new APIError("BAD_REQUEST", {
                message:
                  "Sign-up with disposable email addresses is not allowed.",
              });
            }
          }
        }

        if (!effective.inviteOnly || isInstanceAdminSetup) {
          return;
        }

        const email =
          ctx.body?.email ||
          ctx.query?.email ||
          ctx.headers?.get("x-invitation-email");
        const invitationId = normalizeInvitationId(
          ctx.body?.invitationId ||
            ctx.query?.invitationId ||
            ctx.headers?.get("x-invitation-id"),
        );

        if (ctx.path === "/sign-up/email") {
          const result = await checkRegistrationAllowed(email, invitationId);
          if (!result.allowed) {
            throw new APIError("FORBIDDEN", {
              message: result.reason,
            });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // Leaving runs the same follow-up as an admin removing the member;
        // Better Auth calls afterRemoveMember only for the latter.
        if (ctx.path === "/organization/leave") {
          const left = ctx.context.returned as
            | { organizationId?: unknown; userId?: unknown }
            | undefined;
          if (
            left &&
            !(left instanceof Error) &&
            typeof left.organizationId === "string"
          ) {
            if (typeof left.userId === "string") {
              await clearProjectRolesAfterRemoval(
                left.organizationId,
                left.userId,
              );
            }
            afterWorkspaceMemberRemoved(left.organizationId);
          }
          return;
        }

        if (
          ctx.path.startsWith("/sign-up") ||
          ctx.path.startsWith("/sign-in")
        ) {
          const newSession = ctx.context.newSession;
          if (newSession) {
            const workspaceMember = await db
              .select({ workspaceId: schema.workspaceUserTable.workspaceId })
              .from(schema.workspaceUserTable)
              .where(eq(schema.workspaceUserTable.userId, newSession.user.id))
              .limit(1);

            const activeWorkspaceId = workspaceMember[0]?.workspaceId || null;

            if (activeWorkspaceId) {
              await db
                .update(schema.sessionTable)
                .set({ activeOrganizationId: activeWorkspaceId })
                .where(eq(schema.sessionTable.id, newSession.session.id));
            }
          }
        }
      }),
    },
    advanced: {
      ipAddress: {
        // Set only by the Node transport middleware, never accepted from clients.
        ipAddressHeaders: ["x-margaya-client-ip"],
        trustedProxies: [],
      },
      defaultCookieAttributes: getDefaultCookieAttributes({
        apiUrl,
        clientUrl,
        cookieDomain: process.env.COOKIE_DOMAIN,
      }),
    },
  });
}

export type AuthInstance = ReturnType<typeof createAuthInstance>;

// The stable facade (B12 K27, D20). Callers keep importing `auth` and use
// `auth.handler` and `auth.api`; both delegate to the current instance. The
// instance is rebuilt only when the effective OAuth credentials or endpoints
// change (a fingerprint over them), so environment-only deployments build it
// exactly once. A request already running keeps the instance it started on;
// sessions live in the database, so they survive a rebuild.
let current: { instance: AuthInstance; fingerprint: string } | null = null;
let generation = 0;

function currentAuth(): AuthInstance {
  const settings = getInstanceSettings();
  if (current?.fingerprint === settings.oauthFingerprint) {
    return current.instance;
  }
  const rebuilding = current !== null;
  current = {
    instance: createAuthInstance(settings.oauth),
    fingerprint: settings.oauthFingerprint,
  };
  generation += 1;
  if (rebuilding) {
    console.info(
      "Rebuilt the authentication service after a sign-in provider change",
    );
  }
  return current.instance;
}

export const auth = {
  handler(request: Request): Promise<Response> {
    return currentAuth().handler(request);
  },
  get api(): AuthInstance["api"] {
    return currentAuth().api;
  },
};

/** How many instances were built in this process (1 without rebuilds). */
export function authInstanceGeneration(): number {
  return generation;
}

// Build at import, as before, so configuration errors surface at startup.
currentAuth();
