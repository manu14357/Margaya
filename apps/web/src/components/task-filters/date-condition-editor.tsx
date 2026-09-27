import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import {
  DATE_OPERATOR_LABEL_KEYS,
  DATE_PRESET_LABEL_KEYS,
  fromDayString,
  presetsForKey,
  toDayString,
} from "@/lib/task-query/date-presets";
import {
  DATE_UNITS,
  type DateUnit,
  type FilterCondition,
  ROLLING_OPERATORS,
  type RollingOperator,
} from "@/lib/task-query/model";
import { FilterOptionRow } from "./filter-primitives";

type DateConditionEditorProps = {
  subjectKey: string;
  condition: FilterCondition | undefined;
  /** A new condition for the subject, or null to remove it. */
  onChange: (condition: FilterCondition | null) => void;
  onDone?: () => void;
};

type Tab = "presets" | "exact" | "rolling" | "empty";

const EXACT_OPERATORS = ["on", "onOrBefore", "onOrAfter", "between"] as const;
type ExactOperator = (typeof EXACT_OPERATORS)[number];

function initialTab(condition: FilterCondition | undefined): Tab {
  switch (condition?.operator) {
    case "on":
    case "onOrBefore":
    case "onOrAfter":
    case "between":
      return "exact";
    case "withinLast":
    case "withinNext":
    case "moreThanAgo":
    case "moreThanAhead":
      return "rolling";
    case "empty":
    case "notEmpty":
      return "empty";
    default:
      return "presets";
  }
}

/** Presets, an exact day or range, a rolling window, or empty / not empty. */
export default function DateConditionEditor({
  subjectKey,
  condition,
  onChange,
  onDone,
}: DateConditionEditorProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(() => initialTab(condition));
  const presets = presetsForKey(subjectKey);
  const selectedPresets =
    condition?.operator === "in" ? (condition.values ?? []) : [];

  const [exactOperator, setExactOperator] = useState<ExactOperator>(() =>
    (EXACT_OPERATORS as readonly string[]).includes(condition?.operator ?? "")
      ? (condition?.operator as ExactOperator)
      : "on",
  );
  const [day, setDay] = useState<Date | undefined>(() =>
    fromDayString(condition?.date),
  );
  const [range, setRange] = useState<DateRange | undefined>(() =>
    condition?.from
      ? { from: fromDayString(condition.from), to: fromDayString(condition.to) }
      : undefined,
  );

  const [rollingOperator, setRollingOperator] = useState<RollingOperator>(() =>
    (ROLLING_OPERATORS as readonly string[]).includes(condition?.operator ?? "")
      ? (condition?.operator as RollingOperator)
      : "withinLast",
  );
  const [amount, setAmount] = useState(() => String(condition?.amount ?? 7));
  const [unit, setUnit] = useState<DateUnit>(condition?.unit ?? "days");

  const togglePreset = (preset: string) => {
    const next = selectedPresets.includes(preset)
      ? selectedPresets.filter((value) => value !== preset)
      : [...selectedPresets, preset];
    onChange(
      next.length > 0
        ? { key: subjectKey, operator: "in", values: next }
        : null,
    );
  };

  const applyExact = () => {
    if (exactOperator === "between") {
      if (!range?.from) return;
      const from = toDayString(range.from);
      const to = toDayString(range.to ?? range.from);
      onChange({ key: subjectKey, operator: "between", from, to });
    } else {
      if (!day) return;
      onChange({
        key: subjectKey,
        operator: exactOperator,
        date: toDayString(day),
      });
    }
    onDone?.();
  };

  const parsedAmount = Number.parseInt(amount, 10);
  const amountValid =
    Number.isInteger(parsedAmount) && parsedAmount >= 1 && parsedAmount <= 365;

  const applyRolling = () => {
    if (!amountValid) return;
    onChange({
      key: subjectKey,
      operator: rollingOperator,
      amount: parsedAmount,
      unit,
    });
    onDone?.();
  };

  const setEmpty = (operator: "empty" | "notEmpty") => {
    onChange(
      condition?.operator === operator ? null : { key: subjectKey, operator },
    );
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as Tab)}
      className="w-72 gap-1 p-1"
    >
      <TabsList className="w-full">
        <TabsTab value="presets" className="text-xs sm:text-xs">
          {t("tasks:filters.dates.presets")}
        </TabsTab>
        <TabsTab value="exact" className="text-xs sm:text-xs">
          {t("tasks:filters.dates.exact")}
        </TabsTab>
        <TabsTab value="rolling" className="text-xs sm:text-xs">
          {t("tasks:filters.dates.rolling")}
        </TabsTab>
        <TabsTab value="empty" className="text-xs sm:text-xs">
          {t("tasks:filters.dates.emptyTab")}
        </TabsTab>
      </TabsList>

      <TabsPanel
        value="presets"
        className="grid max-h-72 gap-0.5 overflow-y-auto"
      >
        {presets.map((preset) => (
          <FilterOptionRow
            key={preset}
            checked={selectedPresets.includes(preset)}
            label={t(DATE_PRESET_LABEL_KEYS[preset])}
            onClick={() => togglePreset(preset)}
          />
        ))}
      </TabsPanel>

      <TabsPanel value="exact" className="grid gap-2">
        <Select
          value={exactOperator}
          onValueChange={(value) => setExactOperator(value as ExactOperator)}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue>
              {t(DATE_OPERATOR_LABEL_KEYS[exactOperator] ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EXACT_OPERATORS.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {t(DATE_OPERATOR_LABEL_KEYS[operator] ?? "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {exactOperator === "between" ? (
          <Calendar
            mode="range"
            selected={range}
            onSelect={setRange}
            className="mx-auto"
          />
        ) : (
          <Calendar
            mode="single"
            selected={day}
            onSelect={setDay}
            className="mx-auto"
          />
        )}
        <Button
          size="xs"
          onClick={applyExact}
          disabled={exactOperator === "between" ? !range?.from : !day}
        >
          {t("tasks:filters.apply")}
        </Button>
      </TabsPanel>

      <TabsPanel value="rolling" className="grid gap-2">
        <Select
          value={rollingOperator}
          onValueChange={(value) =>
            setRollingOperator(value as RollingOperator)
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue>
              {t(DATE_OPERATOR_LABEL_KEYS[rollingOperator] ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ROLLING_OPERATORS.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {t(DATE_OPERATOR_LABEL_KEYS[operator] ?? "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <input
            aria-label={t("tasks:filters.dates.amount")}
            className="h-7 w-20 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
            inputMode="numeric"
            max={365}
            min={1}
            onChange={(event) => setAmount(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            type="number"
            value={amount}
          />
          <Select
            value={unit}
            onValueChange={(value) => setUnit(value as DateUnit)}
          >
            <SelectTrigger size="sm" className="flex-1">
              <SelectValue>
                {t(`tasks:filters.dates.units.${unit}`)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DATE_UNITS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`tasks:filters.dates.units.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="xs" onClick={applyRolling} disabled={!amountValid}>
          {t("tasks:filters.apply")}
        </Button>
      </TabsPanel>

      <TabsPanel value="empty" className="grid gap-0.5">
        <FilterOptionRow
          checked={condition?.operator === "empty"}
          label={t("tasks:filters.operators.isEmpty")}
          onClick={() => setEmpty("empty")}
        />
        <FilterOptionRow
          checked={condition?.operator === "notEmpty"}
          label={t("tasks:filters.operators.isNotEmpty")}
          onClick={() => setEmpty("notEmpty")}
        />
      </TabsPanel>
    </Tabs>
  );
}
