import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleDot,
} from "lucide-react";
import type { CycleStatus } from "@/types/cycle";

/** The status a cycle shows: archived wins over the derived status. */
export type CycleDisplayStatus = CycleStatus | "archived";

type CycleStatusMeta = {
  icon: LucideIcon;
  iconClassName: string;
  labelKey: `cycles:status.${CycleDisplayStatus}`;
  badgeVariant: "info" | "secondary" | "outline" | "success";
};

export const CYCLE_STATUS_META: Record<CycleDisplayStatus, CycleStatusMeta> = {
  current: {
    icon: CircleDot,
    iconClassName: "text-info-foreground",
    labelKey: "cycles:status.current",
    badgeVariant: "info",
  },
  upcoming: {
    icon: CalendarClock,
    iconClassName: "text-foreground/70",
    labelKey: "cycles:status.upcoming",
    badgeVariant: "outline",
  },
  draft: {
    icon: CircleDashed,
    iconClassName: "text-muted-foreground",
    labelKey: "cycles:status.draft",
    badgeVariant: "secondary",
  },
  completed: {
    icon: CircleCheck,
    iconClassName: "text-success-foreground",
    labelKey: "cycles:status.completed",
    badgeVariant: "success",
  },
  archived: {
    icon: Archive,
    iconClassName: "text-muted-foreground",
    labelKey: "cycles:status.archived",
    badgeVariant: "secondary",
  },
};

type CycleStateLike = {
  status: CycleStatus;
  archivedAt: string | null;
};

export function cycleDisplayStatus(cycle: CycleStateLike): CycleDisplayStatus {
  return cycle.archivedAt ? "archived" : cycle.status;
}

/** Tasks can move into current, upcoming and draft cycles only. */
export function isAssignableCycle(cycle: CycleStateLike): boolean {
  return (
    !cycle.archivedAt &&
    (cycle.status === "current" ||
      cycle.status === "upcoming" ||
      cycle.status === "draft")
  );
}

/** Completed and archived cycles are read-only. */
export function canEditCycle(cycle: CycleStateLike): boolean {
  return !cycle.archivedAt && cycle.status !== "completed";
}

/** Only completed cycles can be archived. */
export function canArchiveCycle(cycle: CycleStateLike): boolean {
  return !cycle.archivedAt && cycle.status === "completed";
}

/** A completed, unarchived cycle with unfinished tasks offers a transfer. */
export function canTransfer(cycle: CycleStateLike & { pending: number }) {
  return canArchiveCycle(cycle) && cycle.pending > 0;
}

/**
 * The UI offers delete for draft, upcoming and current cycles, to callers
 * with cycle:delete or to the cycle's owner (the API also needs update).
 */
export function canDeleteCycle(
  cycle: CycleStateLike & { ownerId: string | null },
  {
    canDeleteCycles,
    canUpdateCycles,
    userId,
  }: { canDeleteCycles: boolean; canUpdateCycles: boolean; userId?: string },
): boolean {
  if (!canEditCycle(cycle)) return false;
  if (canDeleteCycles) return true;
  return Boolean(
    canUpdateCycles && userId && cycle.ownerId && cycle.ownerId === userId,
  );
}
