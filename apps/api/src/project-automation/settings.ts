import type { ColumnGroup } from "../column/groups";

// Pure settings rules (§3.3.3): merging a PATCH over the stored row, the
// auto-close state, and the list of changed keys. The API validates columns.

export const DEFAULT_AUTOMATION_MONTHS = 3;

export type AutomationSettings = {
  autoArchiveEnabled: boolean;
  autoArchiveMonths: number;
  autoCloseEnabled: boolean;
  autoCloseMonths: number;
  autoCloseColumnId: string | null;
  cycleRolloverEnabled: boolean;
  flowAlertsEnabled: boolean;
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  autoArchiveEnabled: false,
  autoArchiveMonths: DEFAULT_AUTOMATION_MONTHS,
  autoCloseEnabled: false,
  autoCloseMonths: DEFAULT_AUTOMATION_MONTHS,
  autoCloseColumnId: null,
  cycleRolloverEnabled: false,
  flowAlertsEnabled: false,
};

export type AutomationPatch = {
  autoArchive?: { enabled?: boolean; months?: number };
  autoClose?: { enabled?: boolean; months?: number; columnId?: string | null };
  cycleRollover?: { enabled?: boolean };
  flowAlerts?: { enabled?: boolean };
};

const KEY_NAMES: Record<keyof AutomationSettings, string> = {
  autoArchiveEnabled: "autoArchive.enabled",
  autoArchiveMonths: "autoArchive.months",
  autoCloseEnabled: "autoClose.enabled",
  autoCloseMonths: "autoClose.months",
  autoCloseColumnId: "autoClose.columnId",
  cycleRolloverEnabled: "cycleRollover.enabled",
  flowAlertsEnabled: "flowAlerts.enabled",
};

/** True when the patch carries at least one setting. */
export function hasAutomationChanges(patch: AutomationPatch): boolean {
  return [
    patch.autoArchive,
    patch.autoClose,
    patch.cycleRollover,
    patch.flowAlerts,
  ].some(
    (rule) =>
      rule !== undefined &&
      Object.values(rule).some((value) => value !== undefined),
  );
}

/**
 * The settings after a PATCH. Turning a rule off keeps its months and
 * column, so turning it on again restores them. `changed` lists the dotted
 * keys whose value moved.
 */
export function mergeAutomationPatch(
  current: AutomationSettings,
  patch: AutomationPatch,
): { next: AutomationSettings; changed: string[] } {
  const next: AutomationSettings = {
    autoArchiveEnabled:
      patch.autoArchive?.enabled ?? current.autoArchiveEnabled,
    autoArchiveMonths: patch.autoArchive?.months ?? current.autoArchiveMonths,
    autoCloseEnabled: patch.autoClose?.enabled ?? current.autoCloseEnabled,
    autoCloseMonths: patch.autoClose?.months ?? current.autoCloseMonths,
    autoCloseColumnId:
      patch.autoClose?.columnId !== undefined
        ? patch.autoClose.columnId
        : current.autoCloseColumnId,
    cycleRolloverEnabled:
      patch.cycleRollover?.enabled ?? current.cycleRolloverEnabled,
    flowAlertsEnabled: patch.flowAlerts?.enabled ?? current.flowAlertsEnabled,
  };
  const changed = (Object.keys(KEY_NAMES) as (keyof AutomationSettings)[])
    .filter((key) => next[key] !== current[key])
    .map((key) => KEY_NAMES[key]);
  return { next, changed };
}

export type AutoCloseState = "off" | "active" | "paused";
export type AutoClosePausedReason = "no_column" | "column_not_cancelled";

/**
 * An enabled auto-close pauses while its column is gone or has left the
 * cancelled group; the job skips it until a valid column is chosen.
 */
export function autoCloseState(
  settings: Pick<AutomationSettings, "autoCloseEnabled">,
  column: { group: ColumnGroup } | null,
): { state: AutoCloseState; pausedReason: AutoClosePausedReason | null } {
  if (!settings.autoCloseEnabled) return { state: "off", pausedReason: null };
  if (!column) return { state: "paused", pausedReason: "no_column" };
  if (column.group !== "cancelled") {
    return { state: "paused", pausedReason: "column_not_cancelled" };
  }
  return { state: "active", pausedReason: null };
}
