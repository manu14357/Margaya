import { and, eq, sql } from "drizzle-orm";
import db from "../../database";
import { auditLogTable, userTable } from "../../database/schema";
import { CSV_BOM, csvLine } from "../../task-export/encoders/csv";
import type { AuditLogFilter } from "../schema";
import {
  auditEntryColumns,
  auditFilterConditions,
  auditLogOrderBy,
  createdAtKey,
  toAuditEntry,
} from "./list-audit-log";

/** The newest entries a CSV export holds; narrow the filters for older ones. */
export const MAX_EXPORT_ROWS = 10_000;
const CHUNK = 1000;

const HEADER = [
  "time",
  "action",
  "actor_type",
  "actor_name",
  "actor_user_id",
  "api_key_id",
  "target_type",
  "target_id",
  "target_label",
  "ip_address",
  "user_agent",
  "details",
];

/**
 * The filtered audit log as CSV, newest first, at most MAX_EXPORT_ROWS
 * entries, streamed in chunks of CHUNK rows.
 */
export function exportAuditLogCsv(workspaceId: string, filter: AuditLogFilter) {
  const encoder = new TextEncoder();
  const where = auditFilterConditions(workspaceId, filter);
  let sent = 0;
  let last: { createdAt: string; id: string } | null = null;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true;
        controller.enqueue(encoder.encode(CSV_BOM + csvLine(HEADER)));
      }
      const size = Math.min(CHUNK, MAX_EXPORT_ROWS - sent);
      const rows =
        size > 0
          ? await db
              .select({ ...auditEntryColumns, cursorKey: createdAtKey })
              .from(auditLogTable)
              .leftJoin(userTable, eq(userTable.id, auditLogTable.actorUserId))
              .where(
                and(
                  where,
                  last
                    ? sql`(${auditLogTable.createdAt}, ${auditLogTable.id}) < (${last.createdAt}::timestamptz, ${last.id}::text)`
                    : undefined,
                ),
              )
              .orderBy(...auditLogOrderBy)
              .limit(size)
          : [];
      sent += rows.length;
      const tail = rows[rows.length - 1];
      if (tail) last = { createdAt: tail.cursorKey, id: tail.id };
      const text = rows
        .map(({ cursorKey: _cursorKey, ...row }) => {
          const entry = toAuditEntry(row);
          return csvLine([
            entry.createdAt,
            entry.action,
            entry.actor.type,
            entry.actor.name,
            entry.actor.userId,
            entry.actor.apiKeyId,
            entry.target?.type,
            entry.target?.id,
            entry.target?.label,
            entry.ipAddress,
            entry.userAgent,
            entry.metadata,
          ]);
        })
        .join("");
      if (text) controller.enqueue(encoder.encode(text));
      if (rows.length < size || size === 0) controller.close();
    },
  });
}
