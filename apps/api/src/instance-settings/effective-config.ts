import type { SmtpConfig } from "@margaya/email";
import type { InstanceSettingsSnapshot } from "./resolve";

// Adapters from the snapshot to what existing code consumes.

/** SMTP settings for the email package's provider. */
export function smtpConfigOf(snapshot: InstanceSettingsSnapshot): SmtpConfig {
  const smtp = snapshot.effective.smtp;
  return {
    host: smtp.host,
    port: smtp.port,
    security: smtp.security,
    user: smtp.user,
    password: smtp.password,
    from: smtp.from,
  };
}

/** The `/config` fields that come from instance settings. */
export function configFieldsOf(snapshot: InstanceSettingsSnapshot) {
  const { effective, derived } = snapshot;
  return {
    disableRegistration: effective.inviteOnly,
    disablePasswordRegistration: !effective.emailSignUp,
    disableEmailOtpSignIn: !effective.emailCodeSignIn,
    disableWorkspaceCreation: effective.restrictWorkspaceCreation,
    hasSmtp: derived.smtpConfigured,
    hasGithubSignIn: derived.providers.github.active,
    hasGoogleSignIn: derived.providers.google.active,
    hasDiscordSignIn: derived.providers.discord.active,
    hasCustomOAuth: derived.providers.custom.active,
    hasGuestAccess: derived.guestAccessActive,
    disableLoginForm: !effective.emailSignIn,
    customOAuthAutoLogin: effective.customOAuth.autoSignIn,
    customOAuthLogoutUrl: effective.customOAuth.logoutUrl || null,
    instanceName: effective.instanceName,
    customOAuthButtonLabel: effective.customOAuth.buttonLabel || null,
    publicBoardsEnabled: effective.publicBoards.enabled,
    passwordResetEnabled: effective.emailSignIn && derived.smtpConfigured,
    publicLandingEnabled: effective.publicLanding,
    passwordSignUpForInvitations:
      !effective.emailSignUp && effective.emailSignUpForInvitations,
    requiredSignInProvider:
      effective.requiredProvider &&
      derived.providers[effective.requiredProvider].active
        ? effective.requiredProvider
        : null,
  };
}
