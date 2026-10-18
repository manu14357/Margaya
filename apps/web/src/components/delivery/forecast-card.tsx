import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useForecast } from "@/hooks/queries/delivery/use-delivery";
import { cn } from "@/lib/cn";
import { formatCycleDate } from "@/lib/cycle/dates";
import { formatNumber } from "@/lib/format";
import type { DeliveryForecast, DeliveryScopeType } from "@/types/delivery";

type ForecastCardProps = {
  projectId: string;
  scope: DeliveryScopeType;
  id: string;
  className?: string;
};

/** "How is this calculated?": the method and the sample it drew from. */
function MethodPopover({ forecast }: { forecast: DeliveryForecast }) {
  const { t } = useTranslation();
  const { history, method } = forecast;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={t("delivery:forecast.howCalculated")}
            title={t("delivery:forecast.howCalculated")}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <Info className="size-3.5" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" className="w-80 max-w-[90vw]">
        <div className="space-y-2 p-3 text-xs">
          <PopoverTitle className="font-medium text-sm">
            {t("delivery:forecast.method.title")}
          </PopoverTitle>
          <p className="text-muted-foreground leading-relaxed">
            {t("delivery:forecast.method.body", {
              iterations: formatNumber(method.iterations),
            })}
          </p>
          <ul className="space-y-0.5 tabular-nums">
            {history.from && history.to && (
              <li>
                {t("delivery:forecast.method.window", {
                  from: formatCycleDate(history.from),
                  to: formatCycleDate(history.to),
                })}
              </li>
            )}
            <li>
              {t("delivery:forecast.method.completed", {
                total: history.completed,
              })}
            </li>
            <li>
              {t("delivery:forecast.method.activeDays", {
                days: history.activeDays,
              })}
            </li>
            <li>
              {t("delivery:forecast.method.perDay", {
                min: history.minPerDay,
                max: history.maxPerDay,
              })}
            </li>
            <li>
              {t("delivery:forecast.method.perWeek", {
                perWeek: formatNumber(history.perWeek),
              })}
            </li>
          </ul>
          <p className="text-muted-foreground">
            {t("delivery:forecast.method.team")}
          </p>
          <p className="text-muted-foreground">
            {t("delivery:forecast.method.seed", { seed: method.seed })}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ForecastBody({ forecast }: { forecast: DeliveryForecast }) {
  const { t } = useTranslation();
  if (forecast.status === "complete") {
    return (
      <p className="flex items-center gap-1.5 text-sm">
        <CircleCheck className="size-4 text-muted-foreground" aria-hidden />
        {t("delivery:forecast.complete")}
      </p>
    );
  }
  if (forecast.status === "insufficient_history") {
    return (
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t(`delivery:forecast.insufficient.${forecast.reason ?? "short_span"}`)}
      </p>
    );
  }
  const { p50, p85, p95, probabilityByEnd, scope } = forecast;
  const percent =
    probabilityByEnd === null ? null : Math.round(probabilityByEnd * 100);
  const unlikely = percent !== null && percent < 50;
  return (
    <div className="space-y-1">
      <p className="font-medium text-sm">
        {p85
          ? t("delivery:forecast.likelyBy", { date: formatCycleDate(p85.date) })
          : t("delivery:forecast.beyondHorizon")}
      </p>
      {p50 && p95 && (
        <p className="text-muted-foreground text-xs tabular-nums">
          {t("delivery:forecast.percentiles", {
            p50: formatCycleDate(p50.date),
            p95: formatCycleDate(p95.date),
          })}
        </p>
      )}
      {percent !== null && scope.endDate && (
        <p
          className={cn(
            "flex items-center gap-1 text-xs tabular-nums",
            unlikely ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {unlikely && <TriangleAlert className="size-3.5" aria-hidden />}
          {t("delivery:forecast.chanceByEnd", {
            percent,
            date: formatCycleDate(scope.endDate),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * When will the open work be done? A Monte Carlo forecast over the
 * project's real throughput, with its method one click away.
 */
export default function ForecastCard({
  projectId,
  scope,
  id,
  className,
}: ForecastCardProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useForecast({
    projectId,
    scope,
    id,
  });

  return (
    <section
      aria-label={t("delivery:forecast.title")}
      className={cn("space-y-2 rounded-xl border bg-card p-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">
          {t("delivery:forecast.title")}
        </h3>
        <div className="flex items-center gap-1">
          {data && data.status !== "complete" && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("delivery:forecast.open", { count: data.remaining })}
            </span>
          )}
          {data && <MethodPopover forecast={data} />}
        </div>
      </div>
      {isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : isError || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span>{t("delivery:forecast.error")}</span>
          <Button variant="outline" size="xs" onClick={() => refetch()}>
            {t("delivery:forecast.retry")}
          </Button>
        </div>
      ) : (
        <ForecastBody forecast={data} />
      )}
    </section>
  );
}
