import { Download, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsGroupMessage,
} from "@/components/settings-layout";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCostMicros,
  formatCount,
  USAGE_RANGE_KEYS,
  USAGE_RANGES,
  type UsageRange,
} from "@/lib/ai/format";
import { toast } from "@/lib/toast";

// The AI ledger, read-only: three totals, spend per day, and ranked tables.
// One series in one muted hue; every value is also in a table, so nothing
// depends on reading the bars.

type Totals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
};

export type UsageRow = Totals & { id: string; label: string };

/** 👍 / 👎 on AI answers: totals and per feature (labels translated). */
export type UsageFeedback = {
  up: number;
  down: number;
  byFeature: { id: string; label: string; up: number; down: number }[];
};

type UsageDashboardProps = {
  totals: Totals | undefined;
  byDay: (Totals & { day: string })[];
  /** Ranked breakdowns, e.g. by feature, model and person. */
  tables: { title: string; rows: UsageRow[] }[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  feedback?: UsageFeedback;
};

/** Downloads the usage ledger for the range as a CSV file. */
export function UsageExportButton({
  fileName,
  load,
}: {
  fileName: string;
  load: () => Promise<string>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    try {
      const csv = await load();
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      toast.error(t("ai:usage.exportError"));
    } finally {
      setPending(false);
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() => void run()}
    >
      <Download aria-hidden />
      {t("ai:usage.exportCsv")}
    </Button>
  );
}

function positiveShare(up: number, down: number) {
  const total = up + down;
  return total === 0 ? null : Math.round((up / total) * 100);
}

/** How people rated AI answers, overall and per feature. */
function FeedbackTable({ feedback }: { feedback: UsageFeedback }) {
  const { t } = useTranslation();
  const overall = positiveShare(feedback.up, feedback.down);
  return (
    <div className="min-w-0 space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-medium text-foreground text-xs">
          {t("ai:usage.feedbackTitle")}
        </h3>
        {overall !== null && (
          <span className="text-muted-foreground text-xs">
            {t("ai:usage.feedbackOverall", {
              percent: overall,
              total: feedback.up + feedback.down,
            })}
          </span>
        )}
      </div>
      <table className="w-full table-fixed text-xs">
        <thead className="sr-only">
          <tr>
            <th>{t("ai:usage.byFeature")}</th>
            <th>{t("ai:usage.feedbackUp")}</th>
            <th>{t("ai:usage.feedbackDown")}</th>
            <th>{t("ai:usage.feedbackRate")}</th>
          </tr>
        </thead>
        <tbody>
          {feedback.byFeature.map((row) => {
            const share = positiveShare(row.up, row.down);
            return (
              <tr key={row.id} className="align-middle">
                <td className="w-[45%] py-1 pr-2">
                  <span className="block truncate text-foreground">
                    {row.label}
                  </span>
                  <span
                    aria-hidden
                    className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
                  >
                    <span
                      className="block h-full rounded-full bg-primary/60"
                      style={{ width: `${share ?? 0}%` }}
                    />
                  </span>
                </td>
                <td className="py-1 text-right text-muted-foreground tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <ThumbsUp aria-hidden className="size-3" />
                    {row.up}
                  </span>
                </td>
                <td className="py-1 text-right text-muted-foreground tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <ThumbsDown aria-hidden className="size-3" />
                    {row.down}
                  </span>
                </td>
                <td className="py-1 text-right text-foreground tabular-nums">
                  {share === null ? "–" : `${share}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function UsageRangeSelect({
  value,
  onChange,
}: {
  value: UsageRange;
  onChange: (range: UsageRange) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as UsageRange)}
    >
      <SelectTrigger
        size="sm"
        className="w-40"
        aria-label={t("ai:usage.rangeLabel")}
      >
        <SelectValue>{t(USAGE_RANGE_KEYS[value])}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {USAGE_RANGES.map((range) => (
          <SelectItem key={range} value={range}>
            {t(USAGE_RANGE_KEYS[range])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 space-y-1 px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold text-foreground text-lg tabular-nums">
        {value}
      </p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

function DayBars({ byDay }: { byDay: (Totals & { day: string })[] }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...byDay.map((row) => row.calls));
  return (
    <figure className="space-y-2 px-4 py-3">
      <figcaption className="text-muted-foreground text-xs">
        {t("ai:usage.byDay")}
      </figcaption>
      <div className="flex h-24 items-end gap-0.5" aria-hidden>
        {byDay.map((row) => (
          <div
            key={row.day}
            title={`${row.day}: ${t("ai:usage.callsCount", { count: row.calls })} · ${formatCostMicros(row.costMicros, i18n.language)}`}
            className="min-w-1 flex-1 rounded-t-[4px] bg-primary/60 hover:bg-primary"
            style={{ height: `${Math.max(4, (row.calls / max) * 100)}%` }}
          />
        ))}
      </div>
      <table className="sr-only">
        <caption>{t("ai:usage.byDay")}</caption>
        <thead>
          <tr>
            <th>{t("ai:usage.day")}</th>
            <th>{t("ai:usage.calls")}</th>
            <th>{t("ai:usage.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {byDay.map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td>{row.calls}</td>
              <td>{formatCostMicros(row.costMicros, i18n.language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function RankedTable({ title, rows }: { title: string; rows: UsageRow[] }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...rows.map((row) => row.calls));
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="font-medium text-foreground text-xs">{title}</h3>
      <table className="w-full table-fixed text-xs">
        <thead className="sr-only">
          <tr>
            <th>{title}</th>
            <th>{t("ai:usage.calls")}</th>
            <th>{t("ai:usage.tokens")}</th>
            <th>{t("ai:usage.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="align-middle">
              <td className="w-[45%] py-1 pr-2">
                <span className="block truncate text-foreground">
                  {row.label}
                </span>
                <span
                  aria-hidden
                  className="mt-1 block h-1 rounded-full bg-primary/50"
                  style={{ width: `${Math.max(2, (row.calls / max) * 100)}%` }}
                />
              </td>
              <td className="py-1 text-right text-muted-foreground tabular-nums">
                {t("ai:usage.callsCount", { count: row.calls })}
              </td>
              <td className="py-1 text-right text-muted-foreground tabular-nums">
                {formatCount(row.inputTokens + row.outputTokens, i18n.language)}
              </td>
              <td className="py-1 text-right text-foreground tabular-nums">
                {formatCostMicros(row.costMicros, i18n.language)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiUsageDashboard({
  totals,
  byDay,
  tables,
  isLoading,
  isError,
  onRetry,
  feedback,
}: UsageDashboardProps) {
  const { t, i18n } = useTranslation();
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !totals) {
    return (
      <SettingsGroup>
        <div className="flex items-center gap-3 px-4 py-4 text-muted-foreground text-xs">
          <span>{t("ai:usage.loadError")}</span>
          <Button variant="outline" size="xs" onClick={onRetry}>
            {t("ai:usage.retry")}
          </Button>
        </div>
      </SettingsGroup>
    );
  }
  if (totals.calls === 0) {
    return (
      <SettingsGroup>
        <SettingsGroupMessage>{t("ai:usage.empty")}</SettingsGroupMessage>
      </SettingsGroup>
    );
  }
  return (
    <SettingsGroup>
      <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Tile
          label={t("ai:usage.calls")}
          value={formatCount(totals.calls, i18n.language)}
        />
        <Tile
          label={t("ai:usage.tokens")}
          value={formatCount(
            totals.inputTokens + totals.outputTokens,
            i18n.language,
          )}
          hint={t("ai:usage.tokensSplit", {
            input: formatCount(totals.inputTokens, i18n.language),
            output: formatCount(totals.outputTokens, i18n.language),
          })}
        />
        <Tile
          label={t("ai:usage.cost")}
          value={formatCostMicros(totals.costMicros, i18n.language)}
          hint={t("ai:usage.costHint")}
        />
      </div>
      {byDay.length > 0 && <DayBars byDay={byDay} />}
      <div className="grid gap-5 px-4 py-3 md:grid-cols-2">
        {tables
          .filter((table) => table.rows.length > 0)
          .map((table) => (
            <RankedTable
              key={table.title}
              title={table.title}
              rows={table.rows}
            />
          ))}
      </div>
      {feedback && feedback.byFeature.length > 0 && (
        <FeedbackTable feedback={feedback} />
      )}
    </SettingsGroup>
  );
}
