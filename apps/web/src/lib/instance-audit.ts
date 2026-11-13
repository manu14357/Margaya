// Static i18n keys for the instance audit trail's actions. The API's action
// names are stable; an action this build does not know reads as its name.

export const INSTANCE_AUDIT_ACTION_KEYS = {
  "instance.settings_updated":
    "accountSecurity:auditTrail.actions.instanceSettingsUpdated",
  "instance.admin_added":
    "accountSecurity:auditTrail.actions.instanceAdminAdded",
  "instance.admin_removed":
    "accountSecurity:auditTrail.actions.instanceAdminRemoved",
  "instance.reauthenticated":
    "accountSecurity:auditTrail.actions.instanceReauthenticated",
  "user.created": "accountSecurity:auditTrail.actions.userCreated",
  "user.role_changed": "accountSecurity:auditTrail.actions.userRoleChanged",
  "user.banned": "accountSecurity:auditTrail.actions.userBanned",
  "user.unbanned": "accountSecurity:auditTrail.actions.userUnbanned",
  "user.removed": "accountSecurity:auditTrail.actions.userRemoved",
  "user.password_set": "accountSecurity:auditTrail.actions.userPasswordSet",
  "user.password_reset_sent": "accountSecurity:platform.auditPasswordResetSent",
  "user.sessions_revoked":
    "accountSecurity:auditTrail.actions.userSessionsRevoked",
  "user.two_factor_reset":
    "accountSecurity:auditTrail.actions.userTwoFactorReset",
  "user.impersonated": "accountSecurity:auditTrail.actions.userImpersonated",
  "cli.admin_promoted": "accountSecurity:auditTrail.actions.cliAdminPromoted",
  "cli.admin_demoted": "accountSecurity:auditTrail.actions.cliAdminDemoted",
  "cli.password_reset": "accountSecurity:auditTrail.actions.cliPasswordReset",
  "cli.two_factor_reset":
    "accountSecurity:auditTrail.actions.cliTwoFactorReset",
  "cli.user_unbanned": "accountSecurity:auditTrail.actions.cliUserUnbanned",
  "workspace.deletion_scheduled":
    "settings:workspaceDeletion.instanceAudit.scheduled",
  "workspace.deletion_cancelled":
    "settings:workspaceDeletion.instanceAudit.cancelled",
  "workspace.purged": "settings:workspaceDeletion.instanceAudit.purged",
  "scim.connection_created":
    "accountSecurity:auditTrail.actions.scimConnectionCreated",
  "scim.token_rotated": "accountSecurity:auditTrail.actions.scimTokenRotated",
  "scim.connection_deleted":
    "accountSecurity:auditTrail.actions.scimConnectionDeleted",
  "scim.user_provisioned":
    "accountSecurity:auditTrail.actions.scimUserProvisioned",
  "scim.user_deactivated":
    "accountSecurity:auditTrail.actions.scimUserDeactivated",
  "scim.user_reactivated":
    "accountSecurity:auditTrail.actions.scimUserReactivated",
  "scim.user_removed": "accountSecurity:auditTrail.actions.scimUserRemoved",
  "saml.connection_created":
    "accountSecurity:auditTrail.actions.samlConnectionCreated",
  "saml.connection_updated":
    "accountSecurity:auditTrail.actions.samlConnectionUpdated",
  "saml.connection_deleted":
    "accountSecurity:auditTrail.actions.samlConnectionDeleted",
  "feedback.deleted": "settings:feedback.admin.auditDeleted",
} as const;
