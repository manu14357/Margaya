import { and, eq, gte, like, lt, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { auditLogTable, userTable } from "../../database/schema";
import { textArray } from "../../task-query/context";
import type { AuditLogFilter, ListAuditLogInput } from "../schema";
import { auditLogRetentionDays } from "../settings";

export const INVALID_CURSOR = "Invalid cursor";

type Cursor = { createdAt: string; id: string };

export function encodeAuditCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString(
    "base64url",
  );
}

/** Throws 400 "Invalid cursor" when malformed. */
export function decodeAuditCursor(raw: string): Cursor {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const separator = text.indexOf("|");
  const createdAt = separator > 0 ? text.slice(0, separator) : "";
  const id = separator > 0 ? text.slice(separator + 1) : "";
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new HTTPException(400, { message: INVALID_CURSOR });
  }
  return { createdAt, id };
}

// The creation instant with microseconds, so cursors are exact.
export const createdAtKey = sql<string>`to_char(${auditLogTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The WHERE conditions shared by the list and the CSV export. */
export function auditFilterConditions(
  workspaceId: string,
  filter: AuditLogFilter,
): SQL | undefined {
  const action = filter.action;
  // "member" and "member." both mean every membership action.
  const prefix = action && !action.includes(".") ? `${action}.` : action;
  const conditions: (SQL | undefined)[] = [
    eq(auditLogTable.workspaceId, workspaceId),
    filter.actorId ? eq(auditLogTable.actorUserId, filter.actorId) : undefined,
    filter.actorType
      ? eq(auditLogTable.actorType, filter.actorType)
      : undefined,
    prefix
      ? prefix.endsWith(".")
        ? like(auditLogTable.action, `${escapeLike(prefix)}%`)
        : eq(auditLogTable.action, prefix)
      : undefined,
    filter.targetType
      ? eq(auditLogTable.targetType, filter.targetType)
      : undefined,
    filter.from
      ? gte(auditLogTable.createdAt, new Date(filter.from))
      : undefined,
    filter.to ? lt(auditLogTable.createdAt, new Date(filter.to)) : undefined,
    filter.hiddenProjectIds?.length
      ? sql`not (
          (${auditLogTable.targetType} = 'project' and ${auditLogTable.targetId} = any(${textArray(filter.hiddenProjectIds)}))
          or coalesce(${auditLogTable.metadata}->>'projectId', '') = any(${textArray(filter.hiddenProjectIds)})
        )`
      : undefined,
  ];
  return and(...conditions);
}

export const auditEntryColumns = {
  id: auditLogTable.id,
  action: auditLogTable.action,
  actorType: auditLogTable.actorType,
  actorUserId: auditLogTable.actorUserId,
  apiKeyId: auditLogTable.apiKeyId,
  actorName: auditLogTable.actorName,
  actorImage: userTable.image,
  targetType: auditLogTable.targetType,
  targetId: auditLogTable.targetId,
  targetLabel: auditLogTable.targetLabel,
  metadata: auditLogTable.metadata,
  ipAddress: auditLogTable.ipAddress,
  userAgent: auditLogTable.userAgent,
  createdAt: auditLogTable.createdAt,
};

export type AuditEntryRow = {
  [K in keyof typeof auditEntryColumns]:
    | (typeof auditEntryColumns)[K]["_"]["data"]
    | null;
} & { id: string; action: string; createdAt: Date };

export function toAuditEntry(row: AuditEntryRow) {
  return {
    id: row.id,
    action: row.action,
    actor: {
      type: (row.actorType ?? "system") as
        | "user"
        | "api_key"
        | "agent"
        | "automation"
        | "system",
      userId: row.actorUserId,
      apiKeyId: row.apiKeyId,
      name: row.actorName,
      image: row.actorImage,
    },
    target: row.targetType
      ? { type: row.targetType, id: row.targetId, label: row.targetLabel }
      : null,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

/**
 * Newest first. "desc nulls last" matches the audit_log_workspace_* indexes
 * exactly (both columns are NOT NULL, so the order is the same as plain
 * desc); plain desc means NULLS FIRST, which the planner cannot read from
 * them and instead walks every workspace's entries by date.
 */
export const auditLogOrderBy = [
  sql`${auditLogTable.createdAt} desc nulls last`,
  sql`${auditLogTable.id} desc nulls last`,
];

/** One page of a workspace's audit log, newest first. */
export async function listAuditLog(
  workspaceId: string,
  input: ListAuditLogInput,
) {
  const after = input.cursor ? decodeAuditCursor(input.cursor) : null;
  const rows = await db
    .select({ ...auditEntryColumns, cursorKey: createdAtKey })
    .from(auditLogTable)
    .leftJoin(userTable, eq(userTable.id, auditLogTable.actorUserId))
    .where(
      and(
        auditFilterConditions(workspaceId, input),
        after
          ? sql`(${auditLogTable.createdAt}, ${auditLogTable.id}) < (${after.createdAt}::timestamptz, ${after.id}::text)`
          : undefined,
      ),
    )
    .orderBy(...auditLogOrderBy)
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(({ cursorKey: _cursorKey, ...row }) => toAuditEntry(row)),
    nextCursor:
      rows.length > input.limit && last
        ? encodeAuditCursor({ createdAt: last.cursorKey, id: last.id })
        : null,
    retentionDays: auditLogRetentionDays(),
  };
}
