import { getStatusLabel } from "@/lib/i18n/domain";

// History rows written by the scheduled automations job (B11 §4.6) and the
// cycle rollover job: no user, and an `automation` marker in the event data.

export type AutomationMarker = {
  rule: "auto_archive" | "auto_close" | "cycle_rollover" | "custom";
  months: number;
  /** A project automation rule ("custom"): its name. */
  ruleName?: string;
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
  const { rule, months, ruleName } = marker as {
    rule?: unknown;
    months?: unknown;
    ruleName?: unknown;
  };
  // A "When → If → Then" rule: the usual history line, by Automation.
  if (rule === "custom") {
    return {
      rule,
      months: 0,
      ruleName: typeof ruleName === "string" ? ruleName : "",
    };
  }
  if (
    rule !== "auto_archive" &&
    rule !== "auto_close" &&
    rule !== "cycle_rollover"
  ) {
    return null;
  }
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
  if (marker.rule === "cycle_rollover") {
    const data = (activity.eventData ?? {}) as {
      oldCycleName?: unknown;
      newCycleName?: unknown;
      oldCycleHidden?: unknown;
      newCycleHidden?: unknown;
    };
    // The API won't name a cycle of a project this reader can't see.
    if (data.oldCycleHidden === true || data.newCycleHidden === true) {
      return t("activity:automation.rolledOverHidden");
    }
    const name = (value: unknown) => (typeof value === "string" ? value : "");
    return t("activity:automation.rolledOver", {
      from: name(data.oldCycleName),
      to: name(data.newCycleName),
    });
  }
  const { newStatus, statusHidden } = (activity.eventData ?? {}) as {
    newStatus?: unknown;
    statusHidden?: unknown;
  };
  if (statusHidden === true) return t("activity:changedStatusHidden");
  return t("activity:automation.closed", {
    count: marker.months,
    to: getStatusLabel(typeof newStatus === "string" ? newStatus : ""),
  });
}
