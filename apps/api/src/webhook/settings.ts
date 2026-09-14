import { DEFAULT_DELIVERY_RETENTION_DAYS } from "./types";

/** Days the delivery log is kept (WEBHOOK_DELIVERY_RETENTION_DAYS, 1–90). */
export function webhookRetentionDays(
  raw: string | undefined = process.env.WEBHOOK_DELIVERY_RETENTION_DAYS,
): number {
  const parsed = raw?.trim() ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_DELIVERY_RETENTION_DAYS;
  return Math.min(90, Math.max(1, parsed));
}
