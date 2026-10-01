import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import {
  clampRange,
  type DateRange,
  DEFAULT_PERIOD,
  effectiveBucket,
  isPeriodPreset,
  localToday,
  PERIOD_PRESETS,
  type PeriodPreset,
  presetRange,
  weekAllowed,
} from "@/lib/analytics/periods";
import {
  formatCycleRange,
  parseCycleDate,
  toCycleDateString,
} from "@/lib/cycle/dates";
import type { AnalyticsDateBucket } from "@/types/analytics";

export type PeriodState = {
  preset: PeriodPreset;
  range: DateRange;
  bucket: AnalyticsDateBucket;
  setPreset: (preset: PeriodPreset) => void;
  setCustomRange: (range: DateRange) => void;
  setBucket: (bucket: AnalyticsDateBucket) => void;
};

/**
 * A trend's period and bucket. A dated cycle context starts as a custom
 * range on the cycle's own dates; the bucket follows the range until chosen.
 */
export function usePeriodState(initialRange?: DateRange | null): PeriodState {
  const [preset, setPresetState] = useState<PeriodPreset>(
    initialRange ? "custom" : DEFAULT_PERIOD,
  );
  const [custom, setCustom] = useState<DateRange | null>(
    initialRange ? clampRange(initialRange) : null,
  );
  const [chosenBucket, setChosenBucket] = useState<AnalyticsDateBucket | null>(
    null,
  );
  const today = localToday();
  const range = useMemo(
    () => (preset === "custom" && custom ? custom : presetRange(preset, today)),
    [preset, custom, today],
  );
  return {
    preset,
    range,
    bucket: effectiveBucket(range, chosenBucket),
    setPreset: (next) => {
      if (next === "custom" && !custom) setCustom(range);
      setPresetState(next);
      setChosenBucket(null);
    },
    setCustomRange: (next) => {
      setCustom(clampRange(next));
      setPresetState("custom");
      setChosenBucket(null);
    },
    setBucket: setChosenBucket,
  };
}

function CustomRangeButton({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const { t } = useTranslation();
  const from = parseCycleDate(range.from);
  const to = parseCycleDate(range.to);

  // Every complete pick applies at once; the popover stays open so both
  // ends can be adjusted, and closes on an outside click.
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="gap-1 font-normal"
            aria-label={t("analytics:periods.custom")}
          />
        }
      >
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        {formatCycleRange(range.from, range.to)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={{ from, to }}
          defaultMonth={from}
          numberOfMonths={1}
          onSelect={(next) => {
            if (next?.from && next.to) {
              onChange({
                from: toCycleDateString(next.from),
                to: toCycleDateString(next.to),
              });
            }
          }}
          className="bg-popover"
        />
      </PopoverContent>
    </Popover>
  );
}

/** Period select (with a custom range) and the Week / Month toggle. */
export default function PeriodControls({ state }: { state: PeriodState }) {
  const { t } = useTranslation();
  const weeksOk = weekAllowed(state.range);

  return (
    <>
      <Select
        value={state.preset}
        onValueChange={(value) => {
          if (isPeriodPreset(value)) state.setPreset(value);
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-36 min-w-0"
          aria-label={t("analytics:trend.period")}
        >
          <SelectValue>{t(`analytics:periods.${state.preset}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PERIOD_PRESETS.map((preset) => (
            <SelectItem key={preset} value={preset}>
              {t(`analytics:periods.${preset}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state.preset === "custom" && (
        <CustomRangeButton
          range={state.range}
          onChange={state.setCustomRange}
        />
      )}
      <ToggleGroup
        size="sm"
        variant="outline"
        aria-label={t("analytics:bucket.label")}
        value={[state.bucket]}
        onValueChange={(values) => {
          const next = values[0];
          if (next === "week" || next === "month") state.setBucket(next);
        }}
      >
        <Toggle
          value="week"
          disabled={!weeksOk}
          title={weeksOk ? undefined : t("analytics:bucket.weekDisabled")}
          className="px-2 text-xs"
        >
          {t("analytics:bucket.week")}
        </Toggle>
        <Toggle value="month" className="px-2 text-xs">
          {t("analytics:bucket.month")}
        </Toggle>
      </ToggleGroup>
    </>
  );
}
