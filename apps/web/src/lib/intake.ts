import type { LucideIcon } from "lucide-react";
import { CircleCheck, CircleDashed, CircleX, Clock, Copy } from "lucide-react";
import type { IntakeStatus, IntakeTab } from "@/types/intake";

// Intake's status model on the web (mirrors the API's status.ts): the five
// statuses, which tab lists them, the effective status of cached rows, and
// what the list selects after a row leaves it.

export const INTAKE_STATUSES = [
  "pending",
  "snoozed",
  "accepted",
  "declined",
  "duplicate",
] as const satisfies readonly IntakeStatus[];

export const OPEN_INTAKE_STATUSES = [
  "pending",
  "snoozed",
] as const satisfies readonly IntakeStatus[];

export const CLOSED_INTAKE_STATUSES = [
  "accepted",
  "declined",
  "duplicate",
] as const satisfies readonly IntakeStatus[];

type BadgeVariant = "outline" | "warning" | "success" | "error" | "secondary";

type IntakeStatusMeta = {
  icon: LucideIcon;
  badgeVariant: BadgeVariant;
  labelKey: `intake:status.${IntakeStatus}.label`;
  descriptionKey: `intake:status.${IntakeStatus}.description`;
  open: boolean;
};

export const INTAKE_STATUS_META: Record<IntakeStatus, IntakeStatusMeta> = {
  pending: {
    icon: CircleDashed,
    badgeVariant: "outline",
    labelKey: "intake:status.pending.label",
    descriptionKey: "intake:status.pending.description",
    open: true,
  },
  snoozed: {
    icon: Clock,
    badgeVariant: "warning",
    labelKey: "intake:status.snoozed.label",
    descriptionKey: "intake:status.snoozed.description",
    open: true,
  },
  accepted: {
    icon: CircleCheck,
    badgeVariant: "success",
    labelKey: "intake:status.accepted.label",
    descriptionKey: "intake:status.accepted.description",
    open: false,
  },
  declined: {
    icon: CircleX,
    badgeVariant: "error",
    labelKey: "intake:status.declined.label",
    descriptionKey: "intake:status.declined.description",
    open: false,
  },
  duplicate: {
    icon: Copy,
    badgeVariant: "secondary",
    labelKey: "intake:status.duplicate.label",
    descriptionKey: "intake:status.duplicate.description",
    open: false,
  },
};

export function isIntakeStatus(value: unknown): value is IntakeStatus {
  return (
    typeof value === "string" &&
    (INTAKE_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpenIntakeStatus(status: IntakeStatus): boolean {
  return INTAKE_STATUS_META[status].open;
}

export function tabOfStatus(status: IntakeStatus): IntakeTab {
  return isOpenIntakeStatus(status) ? "open" : "closed";
}

/** The statuses a tab lists. */
export function tabStatuses(tab: IntakeTab): readonly IntakeStatus[] {
  return tab === "open" ? OPEN_INTAKE_STATUSES : CLOSED_INTAKE_STATUSES;
}

/** The Open tab shows pending only until "Snoozed" is added. */
export function defaultTabStatuses(tab: IntakeTab): readonly IntakeStatus[] {
  return tab === "open" ? ["pending"] : CLOSED_INTAKE_STATUSES;
}

/**
 * A snooze whose time has passed reads as pending, as on the server, so
 * cached rows stay right between refetches.
 */
export function effectiveIntakeStatus(
  item: { status: IntakeStatus; snoozedUntil: string | null },
  now: Date = new Date(),
): IntakeStatus {
  if (
    item.status === "snoozed" &&
    item.snoozedUntil &&
    new Date(item.snoozedUntil).getTime() <= now.getTime()
  ) {
    return "pending";
  }
  return item.status;
}

/** After a row leaves the list: the next row, else the previous, else none. */
export function nextSelectionAfterRemoval(
  ids: readonly string[],
  removedId: string,
): string | null {
  const index = ids.indexOf(removedId);
  if (index === -1) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** Keys come as the project slug plus number; the web shows them upper case. */
export function formatIntakeKey(key: string): string {
  return key.toUpperCase();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until the snooze ends, at least one. */
export function snoozeDaysLeft(
  until: string | Date,
  now: Date = new Date(),
): number {
  const diff = new Date(until).getTime() - now.getTime();
  return Math.max(1, Math.ceil(diff / DAY_MS));
}

/** The intake route of one request, with the tab it is listed under. */
export function intakeItemPath({
  workspaceId,
  projectId,
  itemId,
  status,
}: {
  workspaceId: string;
  projectId: string;
  itemId: string;
  status?: IntakeStatus;
}): string {
  const params = new URLSearchParams({ item: itemId });
  if (status && tabOfStatus(status) === "closed") params.set("tab", "closed");
  return `/dashboard/workspace/${workspaceId}/project/${projectId}/intake?${params.toString()}`;
}
