import { getStatusLabel } from "@/lib/i18n/domain";

// History rows written by the scheduled automations job (B11 §4.6): no user,
// and an `automation` marker in the event data.

export type AutomationMarker = {
  rule: "auto_archive" | "auto_close";
  months: number;
};

export function automationOf(activity: {
  userId: string | null;
  eventData?: unknown;
}): AutomationMarker | null {
  if (activity.userId) return null;
  const data = activity.eventData;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const marker = (data as { automation?: unknown }).automation;
  if (!marker || typeof marker !== "object") return null;
  const { rule, months } = marker as { rule?: unknown; months?: unknown };
  if (rule !== "auto_archive" && rule !== "auto_close") return null;
  return { rule, months: typeof months === "number" ? months : 0 };
}

/** "archived this task after 3 months without updates", and the close line. */
export function automationActivityText(
  activity: { eventData?: unknown },
  marker: AutomationMarker,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (marker.rule === "auto_archive") {
    return t("activity:automation.archived", { count: marker.months });
  }
  const newStatus = (activity.eventData as { newStatus?: unknown })?.newStatus;
  return t("activity:automation.closed", {
    count: marker.months,
    to: getStatusLabel(typeof newStatus === "string" ? newStatus : ""),
  });
}
