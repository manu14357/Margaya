import { useTranslation } from "react-i18next";
import { InstanceSection } from "@/components/instance-admin/instance-page";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminFeedbackSummary } from "@/fetchers/feedback/admin-feedback";
import { useAdminFeedbackSummary } from "@/hooks/queries/feedback/use-feedback";
import { type FeedbackFormat, scaleOptions } from "@/lib/feedback";
import { FORMAT_KEYS, PERIODS } from "./feedback-labels";

type SummaryProps = {
  format: FeedbackFormat | undefined;
  days: number;
  onFormatChange: (format: FeedbackFormat) => void;
  onDaysChange: (days: number) => void;
};

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-xl tabular-nums">{value}</p>
    </div>
  );
}

function maxScore(format: FeedbackFormat) {
  const options = scaleOptions(format);
  return options[options.length - 1]?.score ?? 5;
}

/** Score averages, the happy share, NPS, the distribution and a trend. */
export function FeedbackSummarySection({
  format,
  days,
  onFormatChange,
  onDaysChange,
}: SummaryProps) {
  const { t } = useTranslation();
  const summary = useAdminFeedbackSummary({ format, days });
  const data = summary.data;
  const shown = data?.format ?? format ?? "faces5";

  return (
    <InstanceSection
      title={t("settings:feedback.admin.summaryTitle")}
      boxed={false}
      actions={
        <div className="flex flex-wrap gap-2">
          <Select
            value={shown}
            onValueChange={(value) => onFormatChange(value as FeedbackFormat)}
          >
            <SelectTrigger
              className="w-44"
              aria-label={t("settings:feedback.admin.scale")}
            >
              <SelectValue>{t(FORMAT_KEYS[shown])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FORMAT_KEYS) as FeedbackFormat[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {t(FORMAT_KEYS[option])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(days)}
            onValueChange={(value) => onDaysChange(Number(value))}
          >
            <SelectTrigger
              className="w-36"
              aria-label={t("settings:feedback.admin.period")}
            >
              <SelectValue>
                {t("settings:feedback.admin.lastDays", { count: days })}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((period) => (
                <SelectItem key={period} value={String(period)}>
                  {t("settings:feedback.admin.lastDays", { count: period })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {summary.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-16" />
          ))}
        </div>
      ) : summary.isError || !data ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{t("settings:feedback.admin.loadError")}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void summary.refetch()}
          >
            {t("settings:feedback.admin.retry")}
          </Button>
        </div>
      ) : (
        <SummaryBody data={data} />
      )}
    </InstanceSection>
  );
}

function SummaryBody({ data }: { data: AdminFeedbackSummary }) {
  const { t } = useTranslation();
  const format = data.format;
  const none = t("settings:feedback.admin.none");
  const options = scaleOptions(format);
  const largest = Math.max(1, ...data.distribution.map((row) => row.count));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label={t("settings:feedback.admin.answers")}
          value={String(data.count)}
        />
        <Tile
          label={t("settings:feedback.admin.average")}
          value={
            data.average === null
              ? none
              : t("settings:feedback.admin.outOf", {
                  value: data.average,
                  max: maxScore(format),
                })
          }
        />
        {format === "nps" ? (
          <Tile
            label={t("settings:feedback.admin.nps")}
            value={data.nps === null ? none : String(data.nps)}
          />
        ) : (
          <Tile
            label={t("settings:feedback.admin.satisfaction")}
            value={data.satisfaction === null ? none : `${data.satisfaction}%`}
          />
        )}
        <Tile
          label={t("settings:feedback.admin.comments")}
          value={String(data.comments)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {t("settings:feedback.admin.bySource", {
          general: data.byKind.general,
          survey: data.byKind.survey,
          feature: data.byKind.feature,
        })}
      </p>

      {data.count === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("settings:feedback.admin.summaryEmpty")}
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <figure className="rounded-lg border bg-card p-4">
            <figcaption className="mb-3 text-sm font-medium">
              {t("settings:feedback.admin.distribution")}
            </figcaption>
            <ul className="space-y-1.5">
              {data.distribution.map((row) => {
                const option = options.find((item) => item.score === row.score);
                const share = data.count
                  ? Math.round((row.count / data.count) * 100)
                  : 0;
                return (
                  <li
                    key={row.score}
                    className="grid grid-cols-[minmax(5rem,8rem)_1fr_4.5rem] items-center gap-2 text-xs"
                  >
                    <span className="truncate text-muted-foreground">
                      {option
                        ? t(option.labelKey, { count: option.score })
                        : row.score}
                    </span>
                    <span className="h-2 rounded-full bg-muted">
                      <span
                        className="block h-2 rounded-full bg-chart-1"
                        style={{ width: `${(row.count / largest) * 100}%` }}
                      />
                    </span>
                    <span className="text-right tabular-nums">
                      {row.count} · {share}%
                    </span>
                  </li>
                );
              })}
            </ul>
          </figure>

          <figure className="rounded-lg border bg-card p-4">
            <figcaption className="mb-3 text-sm font-medium">
              {format === "nps"
                ? t("settings:feedback.admin.trendNps")
                : t("settings:feedback.admin.trend")}
            </figcaption>
            <TrendChart data={data} />
          </figure>
        </div>
      )}
    </div>
  );
}

/**
 * The happy share (or NPS) per week as columns, with the numbers in a table
 * for screen readers.
 */
function TrendChart({ data }: { data: AdminFeedbackSummary }) {
  const { t } = useTranslation();
  const nps = data.format === "nps";
  const points = data.trend.slice(-26);
  const value = (point: (typeof points)[number]) =>
    (nps ? point.nps : point.satisfaction) ?? 0;

  return (
    <>
      <div aria-hidden className="flex h-32 items-end gap-1">
        {points.map((point) => {
          // NPS runs -100..100; draw it on 0..100 from the middle up.
          const height = nps ? (value(point) + 100) / 2 : value(point);
          return (
            <div
              key={point.week}
              title={`${point.week}: ${value(point)}${nps ? "" : "%"} (${point.count})`}
              className="flex h-full min-w-1 flex-1 items-end"
            >
              <div
                className="w-full rounded-t-sm bg-chart-1"
                style={{ height: `${Math.max(2, height)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div
        aria-hidden
        className="mt-1 flex justify-between text-[11px] text-muted-foreground"
      >
        <span>{points[0]?.week}</span>
        <span>{points[points.length - 1]?.week}</span>
      </div>
      <table className="sr-only">
        <caption>
          {nps
            ? t("settings:feedback.admin.trendNps")
            : t("settings:feedback.admin.trend")}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("settings:feedback.admin.week")}</th>
            <th scope="col">
              {nps
                ? t("settings:feedback.admin.nps")
                : t("settings:feedback.admin.satisfaction")}
            </th>
            <th scope="col">{t("settings:feedback.admin.answers")}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.week}>
              <td>{point.week}</td>
              <td>{value(point)}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
