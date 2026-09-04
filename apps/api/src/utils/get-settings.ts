import { config } from "dotenv-mono";
import { isBillingEnabled } from "../billing/config";
import { configFieldsOf } from "../instance-settings/effective-config";
import { getInstanceSettings } from "../instance-settings/snapshot";
import { exportRetentionDays } from "../task-export/settings";

config();

// Sign-in, sign-up and email fields come from the effective instance
// settings (environment first, then the panel, then defaults). The original
// fields keep their order; the B12 fields come last.
function getSettings() {
  const fields = configFieldsOf(getInstanceSettings());
  return {
    disableRegistration: fields.disableRegistration,
    disablePasswordRegistration: fields.disablePasswordRegistration,
    disableEmailOtpSignIn: fields.disableEmailOtpSignIn,
    disableWorkspaceCreation: fields.disableWorkspaceCreation,
    isDemoMode: process.env.DEMO_MODE === "true",
    hasSmtp: fields.hasSmtp,
    hasGithubSignIn: fields.hasGithubSignIn,
    hasGoogleSignIn: fields.hasGoogleSignIn,
    hasDiscordSignIn: fields.hasDiscordSignIn,
    hasCustomOAuth: fields.hasCustomOAuth,
    hasGuestAccess: fields.hasGuestAccess,
    disableLoginForm: fields.disableLoginForm,
    customOAuthAutoLogin: fields.customOAuthAutoLogin,
    customOAuthLogoutUrl: fields.customOAuthLogoutUrl,
    billingEnabled: isBillingEnabled(),
    exportRetentionDays: exportRetentionDays(),
    instanceName: fields.instanceName,
    customOAuthButtonLabel: fields.customOAuthButtonLabel,
    publicBoardsEnabled: fields.publicBoardsEnabled,
    passwordResetEnabled: fields.passwordResetEnabled,
    publicLandingEnabled: fields.publicLandingEnabled,
  };
}

export default getSettings;
