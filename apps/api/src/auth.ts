import { apiKey } from "@better-auth/api-key";
import { scim } from "@better-auth/scim";
import { sso } from "@better-auth/sso";
import {
  emailCopy,
  OTP_EXPIRY_SECONDS,
  sendEmailChangedEmail,
  sendMagicLinkEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
  sendWorkspaceInvitationEmail,
} from "@margaya/email";
import {
  ac,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  guest,
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
  twoFactor,
} from "better-auth/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import type { UserWithAnonymous } from "better-auth/plugins/anonymous";
import { config } from "dotenv-mono";
import { eq } from "drizzle-orm";
import {
  refuseAgentInvitation,
  refuseAgentManagerRole,
  refuseAgentMember,
  refuseAgentSession,
} from "./ai-agent/guards";
import { auditContext, requestActor } from "./audit-log/context";
import {
  findBillableWorkspaces,
  formatBillableWorkspacesMessage,
} from "./billing/controllers/find-billable-workspaces";
import { syncWorkspaceSeats } from "./billing/controllers/sync-seats";
import db, { schema } from "./database";
import { scimProviderTable, ssoProviderTable } from "./database/schema";
import { publishEvent } from "./events";
import {
  assertSamlEmailInDomain,
  assertSamlSignInAllowed,
  isClosedIdentityPath,
  isSamlAcsPath,
  isScimApiPath,
  samlErrorRedirect,
  samlFailureRedirect,
} from "./identity/saml-policy";
import {
  bindRequestToBrowser,
  consumeAnsweredRequest,
  repostPage,
} from "./identity/saml-request";
import {
  afterScimRequest,
  guardScimRequest,
  scimMayLinkUser,
} from "./identity/scim-hooks";
import { hashScimSecret } from "./identity/scim-token";
import type {
  OAuthBuildConfig,
  OAuthProviderId,
} from "./instance-settings/resolve";
import { getInstanceSettings } from "./instance-settings/snapshot";
import { applyInvitationProjects } from "./invitation/projects";
import { clearMemberProjectRoles } from "./project/people";
import { purgeWorkspaceExports } from "./task-export/storage";
import deleteAccountData from "./user/controllers/delete-account-data";
import {
  type AfterHookContext,
  afterAccountSecurityRules,
  type BeforeHookContext,
  EMAIL_CHANGE_PATHS,
  enforceAccountSecurityRules,
} from "./utils/account-security-hooks";
import {
  authHandoff,
  handOffSession,
  markCrossSiteSignIn,
} from "./utils/auth-handoff";
import { authRateLimitConfig } from "./utils/auth-rate-limit";
import { resolveAuthSecret } from "./utils/auth-secret";
import { checkRegistrationAllowed } from "./utils/check-registration-allowed";
import { checkWorkspaceName } from "./utils/check-workspace-name";
import { mapCustomOAuthProfileToUser } from "./utils/custom-oauth-profile";
import { desktopSignIn } from "./utils/desktop-sign-in";
import { getDeviceAuthClientIds } from "./utils/device-auth-client-ids";
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
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./utils/password-policy";
import {
  assertGuestRegistrationAllowed,
  assertUserRegistrationAllowed,
  invitedPasswordSignUpAllowed,
  normalizeInvitationId,
} from "./utils/registration-policy";
import {
  memberRoleChangeError,
  roleCeilingError,
  splitRoles,
} from "./utils/role-ceiling";
import { enforceSignInPolicy, sessionTimingOf } from "./utils/sign-in-policy";
import { enforceTwoFactorRequirement } from "./utils/two-factor-policy";
import { authCaptchaPaths, verifyTurnstile } from "./utils/verify-turnstile";
import { afterWorkspaceMemberRemoved } from "./utils/workspace-member-removed";
import {
  isGuestNarrowedPath,
  narrowOrganizationReadForGuest,
} from "./workspace/guest-organization-reads";
import { publishMembersChanged } from "./workspace/members-realtime";
import {
  isWorkspacePendingDeletion,
  WORKSPACE_LOCKED_MESSAGE,
} from "./workspace-deletion/lock";
import { isWorkspaceDeletionDue } from "./workspace-deletion/service";

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

const SCHEDULE_DELETION_MESSAGE =
  "Workspaces are deleted after a grace period. Schedule the deletion with POST /api/workspace/{workspaceId}/deletion instead.";

async function assertOrganizationWritable(workspaceId: string | undefined) {
  if (workspaceId && (await isWorkspacePendingDeletion(workspaceId))) {
    throw new APIError("LOCKED", { message: WORKSPACE_LOCKED_MESSAGE });
  }
}

// The app and API on different hosts over HTTPS, where the session cookie is
// partitioned: a provider sign-in may need handing over (utils/auth-handoff.ts).
const crossSiteInstall = getDefaultCookieAttributes({
  apiUrl,
  clientUrl,
}).partitioned;

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

function getAuthEmailCopy(locale?: string | null) {
  return emailCopy(locale).authSubjects;
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

// Better Auth's custom-role endpoints have no organization hooks, so the
// read-only rule for a workspace pending deletion is enforced in the before
// hook instead.
const CUSTOM_ROLE_WRITE_PATHS = new Set([
  "/organization/create-role",
  "/organization/update-role",
  "/organization/delete-role",
]);

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
function createAuthInstance(
  oauth: OAuthBuildConfig,
  sessionLifetimeHours: number,
) {
  return betterAuth({
    // The issuer authenticator apps show next to the code.
    appName: "Margaya",
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
        apikey: schema.apikeyTable,
        deviceCode: schema.deviceCodeTable,
        twoFactor: schema.twoFactorTable,
        scimProvider: scimProviderTable,
        ssoProvider: ssoProviderTable,
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
      // Backstops for the full policy in the before hook (password-policy.ts).
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
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
        async sendVerificationOTP({ email, otp, type }, ctx) {
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
          } else if (type === "change-email") {
            // The new address has no account yet: the requester's locale.
            const locale =
              (
                ctx as
                  | { context?: { session?: { user?: { locale?: unknown } } } }
                  | undefined
              )?.context?.session?.user?.locale ?? null;
            const copy = getAuthEmailCopy(
              typeof locale === "string" ? locale : null,
            );
            await sendOtpEmail(email, copy.changeEmailSubject, {
              otp,
              locale: typeof locale === "string" ? locale : null,
              purpose: "email-change",
            });
          }
        },
        // A signed-in user moves their account to a new address: a code goes
        // to the new address, and the change happens only once it is entered.
        changeEmail: { enabled: true },
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
        // afterCreateOrganization hook. `guest` is static too: a guest's limits
        // must not be editable, and the name stays reserved.
        roles: { owner, guest },
        dynamicAccessControl: {
          enabled: true,
          maximumRolesPerOrganization: 25,
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
            // Workspaces go through the grace period: Better Auth's delete
            // only proceeds once a scheduled deletion is due.
            if (!(await isWorkspaceDeletionDue(organization.id))) {
              throw new APIError("CONFLICT", {
                message: SCHEDULE_DELETION_MESSAGE,
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
          // A workspace pending deletion is read-only.
          // (The update hook's `organization` is the patch, without an id.)
          beforeUpdateOrganization: async ({ member }) => {
            await assertOrganizationWritable(member?.organizationId);
          },
          beforeCreateInvitation: async ({ invitation }) => {
            await assertOrganizationWritable(invitation?.organizationId);
            await refuseAgentInvitation(invitation?.email);
          },
          beforeAcceptInvitation: async ({ invitation }) => {
            await assertOrganizationWritable(invitation?.organizationId);
          },
          beforeAddMember: async ({ member }) => {
            await assertOrganizationWritable(member?.organizationId);
            await refuseAgentMember(member?.userId);
          },
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            await assertOrganizationWritable(member?.organizationId);
            await refuseAgentManagerRole(member?.userId, newRole);
          },
          afterAddMember: async ({ member }) => {
            if (member?.organizationId) {
              void syncWorkspaceSeats(member.organizationId).catch((error) => {
                console.error("Seat sync after member add failed:", error);
              });
              void publishMembersChanged({
                workspaceId: member.organizationId,
              });
            }
          },
          // Accepting an invitation adds the member without afterAddMember.
          afterAcceptInvitation: async ({ invitation, member }) => {
            if (member?.organizationId) {
              // Awaited, so the new member lands with their projects.
              await applyInvitationProjects({
                invitationId: invitation.id,
                workspaceId: member.organizationId,
                userId: member.userId,
                inviterId: invitation.inviterId,
              }).catch((error) => {
                console.error("Adding an invitation's projects failed:", error);
              });
              void publishMembersChanged({
                workspaceId: member.organizationId,
              });
            }
          },
          afterUpdateMemberRole: async ({ member }) => {
            if (member?.organizationId) {
              // A new role can take projects away (a member made guest).
              void publishMembersChanged({
                workspaceId: member.organizationId,
                accessEnded: true,
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
              // Better Auth also lets someone remove themselves here.
              const actorId = requestActor(auditContext.getStore())?.userId;
              await afterWorkspaceMemberRemoved(
                member.organizationId,
                member.userId,
                { byThemselves: actorId === member.userId },
              );
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
      // TOTP with recovery codes. It challenges password sign-in only:
      // email-link and code sign-in are refused for accounts that use it
      // (sign-in-policy.ts), and OAuth providers apply their own checks.
      twoFactor({
        issuer: "Margaya",
        backupCodeOptions: { amount: 10, length: 10 },
      }),
      // Provisioning by an identity provider. Connections are made only by
      // instance admins (identity/), which is why a token may take over an
      // existing account at all; scimMayLinkUser says which.
      scim({
        storeSCIMToken: { hash: async (secret) => hashScimSecret(secret) },
        canGenerateToken: () => false,
        linkExistingUsers: {
          shouldLinkUser: ({ user, provider }) =>
            scimMayLinkUser(user.id, provider.organizationId),
        },
      }),
      // SAML sign-in, same ownership. A row's `domainVerified` is the admin
      // vouching for its domains, which is what lets a verified local account
      // link on first sign-in. Sign-in always starts here: the before hook
      // refuses a response that doesn't answer a request (saml-request.ts says
      // why the plugin's own check can't do it).
      sso({
        domainVerification: { enabled: true },
        organizationProvisioning: { disabled: true },
        saml: {
          requireTimestamps: true,
          // The plugin's own default, set so it also reaches the SAML library:
          // without it the library allows no skew at all, and a provider whose
          // clock is a moment ahead has its NotBefore refused.
          clockSkew: 5 * 60_000,
          algorithms: { onDeprecated: "reject" },
          idpInitiatedCallbackUrl: `${clientUrl.replace(/\/$/, "")}/auth/sign-in`,
        },
      }),
      authHandoff(),
      desktopSignIn(),
      openAPI(),
    ],
    session: {
      // The instance's session lifetime (auth.sessionLifetimeHours); a
      // change rebuilds this instance (see currentAuth).
      ...sessionTimingOf(sessionLifetimeHours),
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
      // Agent users (ai-agent/) never get a session.
      session: {
        create: {
          before: async (session) => {
            await refuseAgentSession(session);
          },
        },
      },
      user: {
        create: {
          before: async (user, ctx) => {
            const provisioned = isScimApiPath(ctx?.path);
            const viaSaml = isSamlAcsPath(ctx?.path);
            if (viaSaml) {
              await assertSamlEmailInDomain(
                user.email,
                ctx?.params?.providerId,
              );
            }
            // An identity provider an instance admin connected vouches for the
            // address, and provider sign-in links only to verified accounts.
            const identityFields =
              provisioned || viaSaml ? { emailVerified: true } : null;
            await assertUserRegistrationAllowed(
              {
                ...(user as Partial<UserWithAnonymous> & { email: string }),
                ...identityFields,
              },
              {
                path: ctx?.path,
                provisioned,
                invitationId:
                  ctx?.body?.invitationId ||
                  ctx?.query?.invitationId ||
                  ctx?.headers?.get("x-invitation-id"),
              },
            );
            return identityFields
              ? { data: { ...user, ...identityFields } }
              : undefined;
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
        if (isClosedIdentityPath(ctx.path)) {
          return unregisteredEndpointResponse();
        }
        // Provisioning carries no session and starts no sign-in, so nothing
        // below applies to it.
        if (isScimApiPath(ctx.path)) return guardScimRequest(ctx);
        if (ctx.path === "/sign-in/sso" || isSamlAcsPath(ctx.path)) {
          assertSamlSignInAllowed();
        }
        if (isSamlAcsPath(ctx.path)) {
          const refused = await consumeAnsweredRequest(ctx);
          if (refused === "repost") return repostPage(ctx);
          if (refused) {
            return new Response(null, {
              status: 302,
              headers: {
                location: `${clientUrl.replace(/\/$/, "")}/auth/sign-in?error=${refused}`,
              },
            });
          }
        }

        const { effective, derived } = getInstanceSettings();

        const verifyingEmail = isEmailVerificationRequest(ctx.path, ctx.body);
        // Verifying or changing the signed-in user's own address is account
        // management, not signing in: the sign-in switches don't apply.
        const accountEmailRequest =
          verifyingEmail || EMAIL_CHANGE_PATHS.has(ctx.path);
        if (
          emailCodeSignInOffAtStartup &&
          isEmailCodePath(ctx.path) &&
          !accountEmailRequest
        ) {
          return unregisteredEndpointResponse();
        }

        await enforceAccountSecurityRules(
          ctx as unknown as BeforeHookContext,
          () =>
            getSessionFromCtx(ctx, { disableRefresh: true }).catch(
              () => null,
            ) as ReturnType<Parameters<typeof enforceAccountSecurityRules>[1]>,
        );

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
          !accountEmailRequest
        ) {
          throw new APIError("FORBIDDEN", {
            message:
              "Local sign-in is disabled. Please use a configured social or OIDC sign-in method.",
          });
        }

        if (
          !effective.emailCodeSignIn &&
          isEmailCodePath(ctx.path) &&
          !accountEmailRequest
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

        // The required provider, allowed domains for invitations, and no
        // email link or code sign-in for accounts with two-factor on. A
        // Response answers like a success without doing anything.
        const policy = await enforceSignInPolicy({
          path: ctx.path,
          body: ctx.body,
          provider,
          accountEmailRequest,
        });
        if (policy) return policy;

        if (effective.requireTwoFactor) {
          await enforceTwoFactorRequirement(ctx.path, () =>
            getSessionFromCtx(ctx, { disableRefresh: true }).catch(() => null),
          );
        }

        if (CUSTOM_ROLE_WRITE_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          }).catch(() => null);
          const workspaceId =
            ctx.body?.organizationId ?? session?.session.activeOrganizationId;
          if (typeof workspaceId === "string") {
            await assertOrganizationWritable(workspaceId);
          }
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

        // Better Auth only stops non-owners from inviting owners; every other
        // role up to the inviter's own is enforced here (see role-ceiling.ts).
        if (ctx.path === "/organization/invite-member") {
          const session = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          }).catch(() => null);
          const workspaceId =
            ctx.body?.organizationId ?? session?.session.activeOrganizationId;
          if (session?.user && typeof workspaceId === "string") {
            const refusal = await roleCeilingError({
              workspaceId,
              userId: session.user.id,
              roles: splitRoles(ctx.body?.role),
              instanceAdmin:
                (session.user as { role?: string | null }).role === "admin",
            });
            if (refusal) {
              throw new APIError(
                refusal.status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
                { message: refusal.message },
              );
            }
          }
        }

        // The same ceiling for an existing member's role. Better Auth only
        // protects the owner role here.
        if (ctx.path === "/organization/update-member-role") {
          const session = await getSessionFromCtx(ctx, {
            disableRefresh: true,
          }).catch(() => null);
          const memberId = ctx.body?.memberId;
          if (session?.user && typeof memberId === "string") {
            const refusal = await memberRoleChangeError({
              memberId,
              userId: session.user.id,
              roles: splitRoles(ctx.body?.role),
              instanceAdmin:
                (session.user as { role?: string | null }).role === "admin",
            });
            if (refusal) {
              throw new APIError(
                refusal.status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
                { message: refusal.message },
              );
            }
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
          if (
            !effective.emailSignUp &&
            !isInstanceAdminSetup &&
            !(await invitedPasswordSignUpAllowed(ctx.body, ctx.headers))
          ) {
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
        if (isScimApiPath(ctx.path)) return afterScimRequest(ctx);

        if (ctx.path === "/sign-in/sso") bindRequestToBrowser(ctx);
        await markCrossSiteSignIn(ctx, crossSiteInstall);

        if (isGuestNarrowedPath(ctx.path)) {
          return narrowOrganizationReadForGuest(ctx);
        }

        await afterAccountSecurityRules(
          ctx as unknown as AfterHookContext,
          async ({ previousEmail, newEmail, userId }) => {
            const [row] = await db
              .select({ locale: schema.userTable.locale })
              .from(schema.userTable)
              .where(eq(schema.userTable.id, userId))
              .limit(1);
            const locale = row?.locale ?? null;
            await sendEmailChangedEmail(
              previousEmail,
              getAuthEmailCopy(locale).emailChangedSubject,
              { newEmail, locale },
            );
          },
        );

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
            await afterWorkspaceMemberRemoved(
              left.organizationId,
              typeof left.userId === "string" ? left.userId : null,
              { byThemselves: true },
            );
          }
          return;
        }

        if (isSamlAcsPath(ctx.path)) {
          const refused = samlFailureRedirect(
            ctx.context.responseHeaders?.get("location"),
            clientUrl,
          );
          if (refused) throw ctx.redirect(refused);
          // A Response, as a thrown redirect would keep the error's status.
          const failed = samlErrorRedirect(ctx.context.returned, clientUrl);
          if (failed) {
            return new Response(null, {
              status: 302,
              headers: { location: failed },
            });
          }
        }

        if (
          ctx.path.startsWith("/sign-up") ||
          ctx.path.startsWith("/sign-in") ||
          isSamlAcsPath(ctx.path)
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

        const handoff = crossSiteInstall
          ? await handOffSession(ctx, clientUrl)
          : null;
        if (handoff) throw ctx.redirect(handoff);
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
  const hours = settings.effective.sessionLifetimeHours;
  const fingerprint = `${settings.oauthFingerprint}:${hours}`;
  if (current?.fingerprint === fingerprint) {
    return current.instance;
  }
  const rebuilding = current !== null;
  current = {
    instance: createAuthInstance(settings.oauth, hours),
    fingerprint,
  };
  generation += 1;
  if (rebuilding) {
    console.info(
      "Rebuilt the authentication service after a sign-in provider or session lifetime change",
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
