import { Ruler } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatDuration,
  formatEstimateNumber,
  formatEstimateValue,
} from "@/lib/estimate/format";
import type { EstimateTotals } from "@/types/estimate";

type EstimateProgressSummaryProps = {
  /** From a cycle or module progress report; null or disabled shows nothing. */
  estimates: EstimateTotals | null | undefined;
};

/**
 * Estimate totals beside a cycle's or module's progress. Numeric systems show
 * completed of total (points, or time); categories show how many tasks sit
 * on each value. Cancelled work is left out of the totals, as it is of the
 * progress percentage.
 */
export default function EstimateProgressSummary({
  estimates,
}: EstimateProgressSummaryProps) {
  const { t } = useTranslation();
  if (!estimates?.enabled || !estimates.type) return null;

  const { type, byGroup } = estimates;
  const taskTotal = estimates.taskCount - byGroup.cancelled.taskCount;
  const estimated =
    estimates.estimatedTaskCount - byGroup.cancelled.estimatedTaskCount;
  const total = (estimates.total ?? 0) - (byGroup.cancelled.total ?? 0);
  const completed = estimates.completed ?? 0;
  const ratio = total > 0 ? Math.min(1, completed / total) : 0;

  const numericLine =
    type === "time"
      ? t("tasks:estimate.totals.time", {
          completed: formatDuration(completed, t),
          total: formatDuration(total, t),
        })
      : t("tasks:estimate.totals.points", {
          completed: formatEstimateNumber(completed),
          total: formatEstimateNumber(total),
          count: total,
        });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Ruler className="size-3.5" />
          {t("tasks:estimate.label")}
        </span>
        {estimates.isNumeric && (
          <span className="font-medium tabular-nums">{numericLine}</span>
        )}
      </div>

      {estimates.isNumeric && total > 0 && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={numericLine}
        >
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}

      {!estimates.isNumeric && (
        <div className="flex flex-wrap gap-1">
          {estimates.distribution
            .filter((row) => row.taskCount > 0)
            .map((row) => (
              <span
                key={row.pointId}
                className="inline-flex h-5.5 items-center gap-1 rounded border border-border/70 bg-muted/55 px-2 text-[10px] text-muted-foreground"
              >
                <span className="font-medium text-foreground/80">
                  {formatEstimateValue(type, row.value, { t })}
                </span>
                <span className="tabular-nums">{row.taskCount}</span>
              </span>
            ))}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {t("tasks:estimate.totals.estimated", {
          estimated,
          total: taskTotal,
        })}
      </p>
    </div>
  );
}
