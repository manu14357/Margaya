import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { cycleBadge, formatCycleDate } from "@/lib/cycle/dates";
import { CYCLE_STATUS_META, cycleDisplayStatus } from "@/lib/cycle/status";
import type { Cycle } from "@/types/cycle";

type CycleStateProps = {
  cycle: Pick<Cycle, "status" | "archivedAt">;
  className?: string;
};

/** The status icon, labelled for screen readers. */
export function CycleStatusIcon({ cycle, className }: CycleStateProps) {
  const { t } = useTranslation();
  const meta = CYCLE_STATUS_META[cycleDisplayStatus(cycle)];
  const Icon = meta.icon;
  return (
    <Icon
      role="img"
      aria-label={t(meta.labelKey)}
      className={cn("size-4 shrink-0", meta.iconClassName, className)}
    />
  );
}

/** "3 days left", "Starts in 5 days", "Ended Mar 3, 2026", "No dates". */
export function useCycleBadgeText() {
  const { t } = useTranslation();
  return (
    cycle: Pick<Cycle, "status" | "startDate" | "endDate" | "today">,
  ): string => {
    const badge = cycleBadge(cycle);
    switch (badge.key) {
      case "cycles:badge.daysLeft":
      case "cycles:badge.startsIn":
        return t(badge.key, { count: badge.count });
      case "cycles:badge.ended":
        return t(badge.key, { date: formatCycleDate(badge.date) });
      default:
        return t(badge.key);
    }
  };
}

type CycleStatusBadgeProps = {
  cycle: Pick<
    Cycle,
    "status" | "archivedAt" | "startDate" | "endDate" | "today"
  >;
  className?: string;
};

/** The time hint, colored by status (archived cycles say "Archived"). */
export function CycleStatusBadge({ cycle, className }: CycleStatusBadgeProps) {
  const { t } = useTranslation();
  const badgeText = useCycleBadgeText();
  const status = cycleDisplayStatus(cycle);
  const meta = CYCLE_STATUS_META[status];
  return (
    <Badge variant={meta.badgeVariant} className={cn("shrink-0", className)}>
      {status === "archived" ? t(meta.labelKey) : badgeText(cycle)}
    </Badge>
  );
}
