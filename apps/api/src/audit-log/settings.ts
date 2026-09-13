export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365;

/**
 * Days audit entries are kept (AUDIT_LOG_RETENTION_DAYS, default 365).
 * 0 keeps them forever; invalid or negative values fall back to the default.
 */
export function auditLogRetentionDays(
  raw: string | undefined = process.env.AUDIT_LOG_RETENTION_DAYS,
): number {
  const text = raw?.trim();
  if (!text || !/^\d+$/.test(text)) return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
  return Math.min(Number.parseInt(text, 10), 36_500);
}
