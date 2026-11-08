// Static i18n keys for every audit action and category. The API's action
// names are stable; an action this build does not know reads as its name.

export const AUDIT_ACTION_KEYS = {
  "member.invited": "settings:workspaceAuditLog.actions.memberInvited",
  "member.invitation_revoked":
    "settings:workspaceAuditLog.actions.memberInvitationRevoked",
  "member.invitation_accepted":
    "settings:workspaceAuditLog.actions.memberInvitationAccepted",
  "member.invitation_declined":
    "settings:workspaceAuditLog.actions.memberInvitationDeclined",
  "member.invitation_role_changed":
    "settings:workspaceAuditLog.actions.memberInvitationRoleChanged",
  "member.invitation_projects_changed":
    "settings:workspaceAuditLog.actions.memberInvitationProjectsChanged",
  "member.provisioned": "settings:workspaceAuditLog.actions.memberProvisioned",
  "member.removed": "settings:workspaceAuditLog.actions.memberRemoved",
  "member.left": "settings:workspaceAuditLog.actions.memberLeft",
  "member.role_changed": "settings:workspaceAuditLog.actions.memberRoleChanged",
  "role.created": "settings:workspaceAuditLog.actions.roleCreated",
  "role.updated": "settings:workspaceAuditLog.actions.roleUpdated",
  "role.deleted": "settings:workspaceAuditLog.actions.roleDeleted",
  "api_key.created": "settings:workspaceAuditLog.actions.apiKeyCreated",
  "api_key.revoked": "settings:workspaceAuditLog.actions.apiKeyRevoked",
  "webhook.created": "settings:workspaceAuditLog.actions.webhookCreated",
  "webhook.updated": "settings:workspaceAuditLog.actions.webhookUpdated",
  "webhook.deleted": "settings:workspaceAuditLog.actions.webhookDeleted",
  "webhook.secret_rotated":
    "settings:workspaceAuditLog.actions.webhookSecretRotated",
  "integration.connected":
    "settings:workspaceAuditLog.actions.integrationConnected",
  "integration.updated":
    "settings:workspaceAuditLog.actions.integrationUpdated",
  "integration.disconnected":
    "settings:workspaceAuditLog.actions.integrationDisconnected",
  "workspace.created": "settings:workspaceAuditLog.actions.workspaceCreated",
  "workspace.updated": "settings:workspaceAuditLog.actions.workspaceUpdated",
  "workspace.ownership_transferred":
    "settings:workspaceAuditLog.actions.workspaceOwnershipTransferred",
  "workspace.deletion_scheduled":
    "settings:workspaceAuditLog.actions.workspaceDeletionScheduled",
  "workspace.deletion_cancelled":
    "settings:workspaceAuditLog.actions.workspaceDeletionCancelled",
  "workspace.public_pages_changed":
    "settings:workspaceAuditLog.actions.workspacePublicPagesChanged",
  "project.created": "settings:workspaceAuditLog.actions.projectCreated",
  "project.trashed": "settings:workspaceAuditLog.actions.projectTrashed",
  "project.restored": "settings:workspaceAuditLog.actions.projectRestored",
  "project.purged": "settings:workspaceAuditLog.actions.projectPurged",
  "project.archived": "settings:workspaceAuditLog.actions.projectArchived",
  "project.unarchived": "settings:workspaceAuditLog.actions.projectUnarchived",
  "project.feature_toggled":
    "settings:workspaceAuditLog.actions.projectFeatureToggled",
  "project.settings_changed":
    "settings:workspaceAuditLog.actions.projectSettingsChanged",
  "public_board.published":
    "settings:workspaceAuditLog.actions.publicBoardPublished",
  "public_board.unpublished":
    "settings:workspaceAuditLog.actions.publicBoardUnpublished",
  "public_board.link_rotated":
    "settings:workspaceAuditLog.actions.publicBoardLinkRotated",
  "public_board.settings_changed":
    "settings:workspaceAuditLog.actions.publicBoardSettingsChanged",
  "page.published": "settings:workspaceAuditLog.actions.pagePublished",
  "page.unpublished": "settings:workspaceAuditLog.actions.pageUnpublished",
  "export.created": "settings:workspaceAuditLog.actions.exportCreated",
  "export.downloaded": "settings:workspaceAuditLog.actions.exportDownloaded",
  "import.run": "settings:workspaceAuditLog.actions.importRun",
  "trash.purged": "settings:workspaceAuditLog.actions.trashPurged",
  "trash.emptied": "settings:workspaceAuditLog.actions.trashEmptied",
  "ai.settings_updated": "settings:workspaceAuditLog.actions.aiSettingsUpdated",
  "ai.triage_labels_applied":
    "settings:workspaceAuditLog.actions.aiTriageLabelsApplied",
  "agent.created": "settings:workspaceAuditLog.actions.agentCreated",
  "agent.updated": "settings:workspaceAuditLog.actions.agentUpdated",
  "agent.deleted": "settings:workspaceAuditLog.actions.agentDeleted",
  "agent.change_applied":
    "settings:workspaceAuditLog.actions.agentChangeApplied",
  "agent.change_approved":
    "settings:workspaceAuditLog.actions.agentChangeApproved",
  "agent.change_rejected":
    "settings:workspaceAuditLog.actions.agentChangeRejected",
  "agent.change_reverted":
    "settings:workspaceAuditLog.actions.agentChangeReverted",
  "agent.schedule_created":
    "settings:workspaceAuditLog.actions.agentScheduleCreated",
  "agent.schedule_updated":
    "settings:workspaceAuditLog.actions.agentScheduleUpdated",
  "agent.schedule_deleted":
    "settings:workspaceAuditLog.actions.agentScheduleDeleted",
  "agent.schedule_disabled":
    "settings:workspaceAuditLog.actions.agentScheduleDisabled",
  "agent.intake_trigger_updated":
    "settings:workspaceAuditLog.actions.agentIntakeTriggerUpdated",
  "agent.intake_trigger_disabled":
    "settings:workspaceAuditLog.actions.agentIntakeTriggerDisabled",
  "ai.connector_created":
    "settings:workspaceAuditLog.actions.aiConnectorCreated",
  "ai.connector_updated":
    "settings:workspaceAuditLog.actions.aiConnectorUpdated",
  "ai.connector_deleted":
    "settings:workspaceAuditLog.actions.aiConnectorDeleted",
  "coding_agent.handoff_sent":
    "settings:workspaceAuditLog.actions.codingAgentHandoffSent",
  "coding_agent.profile_created":
    "settings:workspaceAuditLog.actions.codingAgentProfileCreated",
  "coding_agent.profile_updated":
    "settings:workspaceAuditLog.actions.codingAgentProfileUpdated",
  "coding_agent.profile_deleted":
    "settings:workspaceAuditLog.actions.codingAgentProfileDeleted",
  "a2a.task_received": "settings:workspaceAuditLog.actions.a2aTaskReceived",
  "automation.rule_created":
    "settings:workspaceAuditLog.actions.automationRuleCreated",
  "automation.rule_updated":
    "settings:workspaceAuditLog.actions.automationRuleUpdated",
  "automation.rule_deleted":
    "settings:workspaceAuditLog.actions.automationRuleDeleted",
  "automation.rule_ran": "settings:workspaceAuditLog.actions.automationRuleRan",
} as const;

export type KnownAuditAction = keyof typeof AUDIT_ACTION_KEYS;

export const UNKNOWN_ACTION_KEY = "settings:workspaceAuditLog.actions.unknown";

export const AUDIT_CATEGORY_KEYS = {
  member: "settings:workspaceAuditLog.categories.member",
  role: "settings:workspaceAuditLog.categories.role",
  api_key: "settings:workspaceAuditLog.categories.apiKey",
  webhook: "settings:workspaceAuditLog.categories.webhook",
  integration: "settings:workspaceAuditLog.categories.integration",
  workspace: "settings:workspaceAuditLog.categories.workspace",
  project: "settings:workspaceAuditLog.categories.project",
  public_board: "settings:workspaceAuditLog.categories.publicBoard",
  // Reuses the roles screen's "Pages" label.
  page: "settings:workspaceRoles.resources.page",
  export: "settings:workspaceAuditLog.categories.export",
  import: "settings:workspaceAuditLog.categories.import",
  trash: "settings:workspaceAuditLog.categories.trash",
  // Reuses the roles screen's "AI" label.
  ai: "settings:workspaceRoles.resources.ai",
  agent: "settings:workspaceAuditLog.categories.agent",
  coding_agent: "settings:workspaceAuditLog.categories.codingAgent",
  a2a: "settings:workspaceAuditLog.categories.a2a",
  automation: "settings:workspaceAuditLog.categories.automation",
} as const;

export type AuditCategory = keyof typeof AUDIT_CATEGORY_KEYS;

export const AUDIT_CATEGORIES = Object.keys(
  AUDIT_CATEGORY_KEYS,
) as AuditCategory[];

/** The i18n key of an action's sentence, and the values it interpolates. */
export function auditActionSentence(action: string): {
  key: string;
  values: Record<string, string>;
} {
  if (Object.hasOwn(AUDIT_ACTION_KEYS, action)) {
    return { key: AUDIT_ACTION_KEYS[action as KnownAuditAction], values: {} };
  }
  return { key: UNKNOWN_ACTION_KEY, values: { action } };
}
