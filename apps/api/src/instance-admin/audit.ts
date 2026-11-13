import { and, desc, eq, inArray } from "drizzle-orm";
import { auditContext, requestActor } from "../audit-log/context";
import { trackAudit } from "../audit-log/record";
import { redactMetadata } from "../audit-log/redact";
import db from "../database";
import { instanceAuditLogTable, userTable } from "../database/schema";
import {
  afterKeyset,
  decodeKeyset,
  encodeKeyset,
  timeKey,
} from "../publication/keyset";

// The instance audit trail (who changed what on the instance, and when).
// Stable action names: stored, filtered on and turned into sentences by the
// web app, so never rename one; add a new one instead.
export const INSTANCE_AUDIT_ACTIONS = [
  "instance.settings_updated",
  "instance.admin_added",
  "instance.admin_removed",
  "instance.reauthenticated",
  "user.created",
  "user.role_changed",
  "user.banned",
  "user.unbanned",
  "user.removed",
  "user.password_set",
  "user.password_reset_sent",
  "user.sessions_revoked",
  "user.two_factor_reset",
  "user.impersonated",
  "cli.admin_promoted",
  "cli.admin_demoted",
  "cli.password_reset",
  "cli.two_factor_reset",
  "cli.user_unbanned",
  "workspace.deletion_scheduled",
  "workspace.deletion_cancelled",
  "workspace.purged",
  "scim.connection_created",
  "scim.token_rotated",
  "scim.connection_deleted",
  "scim.user_provisioned",
  "scim.user_deactivated",
  "scim.user_reactivated",
  "scim.user_removed",
  "saml.connection_created",
  "saml.connection_updated",
  "saml.connection_deleted",
  "feedback.deleted",
] as const;

export type InstanceAuditAction = (typeof INSTANCE_AUDIT_ACTIONS)[number];

export type InstanceAuditInput = {
  action: InstanceAuditAction;
  target?: { type: string; id?: string | null; label?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  /** Overrides the request's caller (the CLI has none). */
  actor?: { userId?: string | null; system?: boolean; name?: string | null };
};

const MAX_LABEL = 200;

async function actorName(userId: string) {
  const [row] = await db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row ? row.name || row.email || null : undefined;
}

/** Appends one instance audit entry; never throws. */
export async function recordInstanceAudit(
  input: InstanceAuditInput,
): Promise<void> {
  await trackAudit(async () => {
    const store = auditContext.getStore();
    const system = input.actor?.system === true;
    const userId = system
      ? null
      : (input.actor?.userId ?? requestActor(store)?.userId ?? null);
    const name = userId ? await actorName(userId) : undefined;
    await db.insert(instanceAuditLogTable).values({
      actorType: userId ? "user" : "system",
      // A user deleted meanwhile keeps only the name.
      actorUserId: userId && name !== undefined ? userId : null,
      actorName: input.actor?.name ?? name ?? null,
      action: input.action,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      targetLabel: input.target?.label?.slice(0, MAX_LABEL) ?? null,
      metadata: redactMetadata(input.metadata),
      ipAddress: store?.ip ?? null,
      userAgent: store?.userAgent ?? null,
    });
  });
}

/** The label of a user target: their email, else their name. */
export async function userTargetLabel(userId: string) {
  const [row] = await db
    .select({ name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.email || row?.name || null;
}

type ListQuery = {
  cursor?: string;
  limit: number;
  action?: string[];
};

/** Newest first, paged with nextCursor. */
export async function listInstanceAudit({ cursor, limit, action }: ListQuery) {
  const conditions = [];
  if (action && action.length > 0) {
    conditions.push(inArray(instanceAuditLogTable.action, action));
  }
  if (cursor) {
    conditions.push(
      afterKeyset(
        instanceAuditLogTable.createdAt,
        instanceAuditLogTable.id,
        decodeKeyset(cursor),
        "desc",
      ),
    );
  }
  const rows = await db
    .select({
      id: instanceAuditLogTable.id,
      actorType: instanceAuditLogTable.actorType,
      actorUserId: instanceAuditLogTable.actorUserId,
      actorName: instanceAuditLogTable.actorName,
      action: instanceAuditLogTable.action,
      targetType: instanceAuditLogTable.targetType,
      targetId: instanceAuditLogTable.targetId,
      targetLabel: instanceAuditLogTable.targetLabel,
      metadata: instanceAuditLogTable.metadata,
      ipAddress: instanceAuditLogTable.ipAddress,
      createdAt: instanceAuditLogTable.createdAt,
      at: timeKey(instanceAuditLogTable.createdAt),
    })
    .from(instanceAuditLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      desc(instanceAuditLogTable.createdAt),
      desc(instanceAuditLogTable.id),
    )
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ at: _at, ...row }) => row),
    nextCursor:
      rows.length > limit && last ? encodeKeyset(last.at, last.id) : null,
  };
}
