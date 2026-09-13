// Stable audit action names. They are stored, filtered on and turned into
// sentences by the web app, so never rename one; add a new one instead.
export const AUDIT_ACTIONS = [
  "member.invited",
  "member.invitation_revoked",
  "member.invitation_accepted",
  "member.invitation_declined",
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
  "export.created",
  "export.downloaded",
  "import.run",
  "trash.purged",
  "trash.emptied",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The part before the first dot: what the action-prefix filter groups by. */
export const AUDIT_CATEGORIES = [
  ...new Set(AUDIT_ACTIONS.map((action) => action.split(".")[0] as string)),
] as string[];

export type AuditActorType = "user" | "api_key" | "system";

export type AuditTarget = {
  type: string;
  id?: string | null;
  label?: string | null;
};
