// Stable audit action names. They are stored, filtered on and turned into
// sentences by the web app, so never rename one; add a new one instead.
export const AUDIT_ACTIONS = [
  "member.invited",
  "member.invitation_revoked",
  "member.invitation_accepted",
  "member.invitation_declined",
  "member.invitation_role_changed",
  "member.removed",
  "member.left",
  "member.role_changed",
  "role.created",
  "role.updated",
  "role.deleted",
  "api_key.created",
  "api_key.revoked",
  "webhook.created",
  "webhook.updated",
  "webhook.deleted",
  "webhook.secret_rotated",
  "integration.connected",
  "integration.updated",
  "integration.disconnected",
  "workspace.created",
  "workspace.updated",
  "workspace.ownership_transferred",
  "workspace.deletion_scheduled",
  "workspace.deletion_cancelled",
  "workspace.public_pages_changed",
  "project.created",
  "project.trashed",
  "project.restored",
  "project.purged",
  "project.archived",
  "project.unarchived",
  "project.feature_toggled",
  "project.settings_changed",
  "public_board.published",
  "public_board.unpublished",
  "public_board.link_rotated",
  "public_board.settings_changed",
  "page.published",
  "page.unpublished",
  "export.created",
  "export.downloaded",
  "import.run",
  "trash.purged",
  "trash.emptied",
  "ai.settings_updated",
  "ai.triage_labels_applied",
  "coding_agent.handoff_sent",
  "coding_agent.profile_created",
  "coding_agent.profile_updated",
  "coding_agent.profile_deleted",
  "a2a.task_received",
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "agent.change_applied",
  "agent.change_approved",
  "agent.change_rejected",
  "agent.change_reverted",
  "agent.schedule_created",
  "agent.schedule_updated",
  "agent.schedule_deleted",
  "agent.schedule_disabled",
  "ai.connector_created",
  "ai.connector_updated",
  "ai.connector_deleted",
  "automation.rule_created",
  "automation.rule_updated",
  "automation.rule_deleted",
  "automation.rule_ran",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The part before the first dot: what the action-prefix filter groups by. */
export const AUDIT_CATEGORIES = [
  ...new Set(AUDIT_ACTIONS.map((action) => action.split(".")[0] as string)),
] as string[];

export type AuditActorType =
  | "user"
  | "api_key"
  | "agent"
  | "automation"
  | "system";

export type AuditTarget = {
  type: string;
  id?: string | null;
  label?: string | null;
};
