import type { AuditLogFilters, AuditLogRange } from "@/types/audit-log";

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_DAYS: Record<Exclude<AuditLogRange, "all">, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const AUDIT_LOG_RANGES: AuditLogRange[] = [
  "all",
  "1d",
  "7d",
  "30d",
  "90d",
];

export const DEFAULT_AUDIT_LOG_FILTERS: AuditLogFilters = {
  actorId: null,
  category: null,
  range: "all",
};

/** The API query for these filters (the range ends now). */
export function auditLogQuery(
  workspaceId: string,
  filters: AuditLogFilters,
  now: Date = new Date(),
) {
  return {
    workspaceId,
    actorId: filters.actorId ?? undefined,
    action: filters.category ? `${filters.category}.` : undefined,
    from:
      filters.range === "all"
        ? undefined
        : new Date(
            now.getTime() - RANGE_DAYS[filters.range] * DAY_MS,
          ).toISOString(),
  };
}

export function isFiltered(filters: AuditLogFilters) {
  return (
    filters.actorId !== null ||
    filters.category !== null ||
    filters.range !== "all"
  );
}
