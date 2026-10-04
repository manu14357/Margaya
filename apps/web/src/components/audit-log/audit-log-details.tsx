import { useTranslation } from "react-i18next";
import { summarizeUserAgent } from "@/lib/user-agent";
import type { AuditLogEntry } from "@/types/audit-log";

type FieldChange = { before: unknown; after: unknown };

// A secret field's change is stored as this marker, never its values.
const REDACTED = "[redacted]";

function isChange(value: unknown): value is FieldChange {
  return (
    typeof value === "object" &&
    value !== null &&
    "before" in value &&
    "after" in value
  );
}

/** A metadata value as one line of text; "—" for nothing. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.every((item) => typeof item === "string")
      ? value.join(", ")
      : JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** The changed-fields diff and the other details of one entry. */
export function AuditLogDetails({ entry }: { entry: AuditLogEntry }) {
  const { t } = useTranslation();
  const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
  const rawChanges = metadata.changes;
  const changes =
    rawChanges && typeof rawChanges === "object" && !Array.isArray(rawChanges)
      ? Object.entries(rawChanges as Record<string, unknown>).filter(
          (pair): pair is [string, FieldChange | typeof REDACTED] =>
            isChange(pair[1]) || pair[1] === REDACTED,
        )
      : [];
  const other = Object.entries(metadata).filter(([key]) => key !== "changes");
  const device = summarizeUserAgent(entry.userAgent);
  const deviceText = [device.browser, device.os].filter(Boolean).join(" · ");

  return (
    <div className="space-y-3 text-sm">
      {changes.length > 0 && (
        <table className="w-full max-w-2xl text-left">
          <caption className="sr-only">
            {t("settings:workspaceAuditLog.details.changes")}
          </caption>
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="py-1 pr-4 font-medium">
                {t("settings:workspaceAuditLog.details.field")}
              </th>
              <th className="py-1 pr-4 font-medium">
                {t("settings:workspaceAuditLog.details.before")}
              </th>
              <th className="py-1 font-medium">
                {t("settings:workspaceAuditLog.details.after")}
              </th>
            </tr>
          </thead>
          <tbody>
            {changes.map(([field, change]) => (
              <tr key={field} className="align-top">
                <td className="py-1 pr-4">
                  <code className="font-mono text-xs">{field}</code>
                </td>
                {change === REDACTED ? (
                  <td colSpan={2} className="py-1 text-muted-foreground">
                    {t("settings:workspaceAuditLog.details.hiddenValue")}
                  </td>
                ) : (
                  <>
                    <td className="break-all py-1 pr-4 text-muted-foreground line-through decoration-muted-foreground/50">
                      {formatAuditValue(change.before)}
                    </td>
                    <td className="break-all py-1">
                      {formatAuditValue(change.after)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="grid max-w-2xl grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
        {other.map(([key, value]) => (
          <div key={key} className="contents">
            <dt>
              <code className="font-mono text-muted-foreground text-xs">
                {key}
              </code>
            </dt>
            <dd className="break-all">{formatAuditValue(value)}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground text-xs">
          {t("settings:workspaceAuditLog.details.ipAddress")}
        </dt>
        <dd className="font-mono text-xs">{entry.ipAddress ?? "—"}</dd>
        <dt className="text-muted-foreground text-xs">
          {t("settings:workspaceAuditLog.details.device")}
        </dt>
        <dd title={entry.userAgent ?? undefined}>{deviceText || "—"}</dd>
      </dl>
    </div>
  );
}

export default AuditLogDetails;
