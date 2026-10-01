import { SlidersHorizontal } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
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
import { Switch } from "@/components/ui/switch";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import { type BuilderState, withXAxis } from "@/lib/analytics/builder-state";
import {
  type CategoryDimension,
  DIMENSIONS,
  isAnalyticsDimension,
  isDateDimension,
} from "@/lib/analytics/dimensions";
import type { AnalyticsDimension } from "@/types/analytics";

const NONE = "__none__";

function Labeled({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span id={id} className="text-muted-foreground text-xs">
        {label}
      </span>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-xs">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

type BuilderControlsProps = {
  state: BuilderState;
  onChange: (state: BuilderState) => void;
  /** The x-axis choices of the scope. */
  dimensions: readonly AnalyticsDimension[];
  /** Segment choices for the current x-axis. */
  segments: readonly CategoryDimension[];
  pointsAvailable: boolean;
};

/** X-axis, metric, segment, date bucket and options, in one wrapping row. */
export default function BuilderControls({
  state,
  onChange,
  dimensions,
  segments,
  pointsAvailable,
}: BuilderControlsProps) {
  const { t } = useTranslation();
  const ids = useId();
  const dateX = isDateDimension(state.xAxis);

  return (
    <>
      <Labeled label={t("analytics:builder.xAxis")} id={`${ids}-x`}>
        <Select
          value={state.xAxis}
          onValueChange={(value) => {
            if (isAnalyticsDimension(value)) onChange(withXAxis(state, value));
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-36 min-w-0"
            aria-labelledby={`${ids}-x`}
          >
            <SelectValue>{t(DIMENSIONS[state.xAxis].labelKey)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {dimensions.map((dimension) => (
              <SelectItem key={dimension} value={dimension}>
                {t(DIMENSIONS[dimension].labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Labeled>

      {pointsAvailable && (
        <Labeled label={t("analytics:metric.label")} id={`${ids}-metric`}>
          <Select
            value={state.metric}
            onValueChange={(value) => {
              if (value === "taskCount" || value === "estimatePoints") {
                onChange({ ...state, metric: value });
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-36 min-w-0"
              aria-labelledby={`${ids}-metric`}
            >
              <SelectValue>
                {state.metric === "estimatePoints"
                  ? t("analytics:metric.points")
                  : t("analytics:metric.tasks")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="taskCount">
                {t("analytics:metric.tasks")}
              </SelectItem>
              <SelectItem value="estimatePoints">
                {t("analytics:metric.points")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Labeled>
      )}

      <Labeled label={t("analytics:builder.segment")} id={`${ids}-segment`}>
        <Select
          value={state.segment ?? NONE}
          onValueChange={(value) =>
            onChange({
              ...state,
              segment:
                value === NONE
                  ? null
                  : (segments.find((entry) => entry === value) ?? null),
            })
          }
        >
          <SelectTrigger
            size="sm"
            className="w-36 min-w-0"
            aria-labelledby={`${ids}-segment`}
          >
            <SelectValue>
              {state.segment
                ? t(DIMENSIONS[state.segment].labelKey)
                : t("analytics:builder.segmentNone")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {t("analytics:builder.segmentNone")}
            </SelectItem>
            {segments.map((dimension) => (
              <SelectItem key={dimension} value={dimension}>
                {t(DIMENSIONS[dimension].labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Labeled>

      {dateX && (
        <ToggleGroup
          size="sm"
          variant="outline"
          aria-label={t("analytics:bucket.label")}
          value={[state.dateBucket]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "week" || next === "month") {
              onChange({ ...state, dateBucket: next });
            }
          }}
        >
          <Toggle value="week" className="px-2 text-xs">
            {t("analytics:bucket.week")}
          </Toggle>
          <Toggle value="month" className="px-2 text-xs">
            {t("analytics:bucket.month")}
          </Toggle>
        </ToggleGroup>
      )}

      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-foreground text-xs outline-none hover:bg-accent/60"
            />
          }
        >
          <SlidersHorizontal className="size-3" />
          {t("analytics:builder.options")}
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-64 gap-3 p-3">
          <SwitchRow
            label={t("analytics:builder.includeNone")}
            checked={state.includeNone}
            onChange={(includeNone) => onChange({ ...state, includeNone })}
          />
          {!dateX && (
            <SwitchRow
              label={t("analytics:builder.sortByValue")}
              checked={state.sortByValue}
              onChange={(sortByValue) => onChange({ ...state, sortByValue })}
            />
          )}
          <SwitchRow
            label={t("analytics:builder.countSubTasks")}
            checked={state.showSubTasks}
            onChange={(showSubTasks) => onChange({ ...state, showSubTasks })}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
