import type { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";

type AuditLogRoutes = (typeof client)["audit-log"];

export type AuditLogPage = InferResponseType<AuditLogRoutes["$get"], 200>;

/** One audit log entry as the list returns it. */
export type AuditLogEntry = AuditLogPage["items"][number];

/** A preset window for the date filter, newest entries last N days. */
export type AuditLogRange = "all" | "1d" | "7d" | "30d" | "90d";

export type AuditLogFilters = {
  /** A workspace member's user id. */
  actorId: string | null;
  /** An action category, e.g. "member" (sent as an action prefix). */
  category: string | null;
  range: AuditLogRange;
};
