import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateMedium } from "@/lib/format";
import {
  DATE_OPERATOR_LABEL_KEYS,
  DATE_PRESET_LABEL_KEYS,
  fromDayString,
} from "@/lib/task-query/date-presets";
import type { DatePreset, FilterCondition } from "@/lib/task-query/model";
import DateConditionEditor from "./date-condition-editor";
import FilterOptionList from "./filter-option-list";
import { ActiveFilterChip, StackedIcons } from "./filter-primitives";
import type { FilterSubject } from "./subjects";

type FilterChipProps = {
  subject: FilterSubject;
  condition: FilterCondition;
  /** Replaces the condition; null removes it. */
  onChange: (condition: FilterCondition | null) => void;
  readOnly?: boolean;
  /** Opens the value editor on mount (a subject just picked from the menu). */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function formatDay(value: string | undefined): string {
  const date = fromDayString(value);
  return date ? formatDateMedium(date) : (value ?? "");
}

export function useConditionText() {
  const { t } = useTranslation();

  const operatorText = (condition: FilterCondition, kind: "set" | "date") => {
    const count = condition.values?.length ?? 0;
    if (kind === "set" || condition.operator === "in") {
      if (condition.operator === "notIn") {
        return count === 1
          ? t("tasks:filters.operators.isNot")
          : t("tasks:filters.operators.isNoneOf");
      }
      return count === 1
        ? t("tasks:filters.operators.is")
        : t("tasks:boardFilters.operators.isAnyOf");
    }
    return t(
      DATE_OPERATOR_LABEL_KEYS[condition.operator] ?? condition.operator,
    );
  };

  const dateValueText = (condition: FilterCondition): string | undefined => {
    switch (condition.operator) {
      case "in": {
        const values = condition.values ?? [];
        if (values.length === 1) {
          const key = DATE_PRESET_LABEL_KEYS[values[0] as DatePreset];
          return key ? t(key) : values[0];
        }
        return t("tasks:boardFilters.selectedCount", { count: values.length });
      }
      case "on":
      case "onOrBefore":
      case "onOrAfter":
        return formatDay(condition.date);
      case "between":
        return `${formatDay(condition.from)} – ${formatDay(condition.to)}`;
      case "withinLast":
      case "withinNext":
      case "moreThanAgo":
      case "moreThanAhead":
        return t("tasks:filters.dates.rollingValue", {
          amount: condition.amount,
          unit: t(`tasks:filters.dates.units.${condition.unit ?? "days"}`),
        });
      default:
        return undefined;
    }
  };

  return { operatorText, dateValueText };
}

/** "{Subject} | {operator} | {value} | ×", editable in place (B4 §1.2). */
export default function FilterChip({
  subject,
  condition,
  onChange,
  readOnly = false,
  defaultOpen = false,
  onOpenChange,
}: FilterChipProps) {
  const { t } = useTranslation();
  const [open, setOpenState] = useState(defaultOpen);
  const { operatorText, dateValueText } = useConditionText();
  const values = condition.values ?? [];

  useEffect(() => {
    if (defaultOpen) setOpenState(true);
  }, [defaultOpen]);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const operator = operatorText(condition, subject.kind);

  // Set keys flip between "is any of" and "is none of".
  const cycleOperator = () => {
    onChange({
      ...condition,
      operator: condition.operator === "notIn" ? "in" : "notIn",
    });
  };

  let valueNode: ReactNode;
  if (subject.kind === "date") {
    valueNode = dateValueText(condition);
  } else {
    const selected = values.map((value) => ({
      value,
      option: subject.options.find((option) => option.value === value),
    }));
    const icons = selected
      .filter((entry) => entry.option?.icon)
      .map((entry) => ({ id: entry.value, node: entry.option?.icon }));
    const first = selected[0];
    const ValueLabel = subject.ValueLabel;
    valueNode = (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <StackedIcons items={icons} itemClassName="[&>svg]:size-3.5" />
        <span className="max-w-40 truncate">
          {selected.length === 1 && first
            ? (first.option?.label ??
              (ValueLabel ? <ValueLabel value={first.value} /> : first.value))
            : t("tasks:boardFilters.selectedCount", { count: selected.length })}
        </span>
      </span>
    );
  }

  const editor =
    subject.kind === "date" ? (
      <DateConditionEditor
        subjectKey={subject.key}
        condition={condition}
        onChange={onChange}
        onDone={() => setOpen(false)}
      />
    ) : (
      <div className="w-64">
        <FilterOptionList
          subject={subject}
          selected={values}
          autoFocus
          onToggle={(value) => {
            const next = values.includes(value)
              ? values.filter((candidate) => candidate !== value)
              : [...values, value];
            onChange(next.length > 0 ? { ...condition, values: next } : null);
          }}
        />
      </div>
    );

  const valueButtonClass =
    "flex h-full items-center px-2 text-foreground hover:bg-accent/60 disabled:hover:bg-transparent";
  const accessibleName = `${subject.label} ${operator} ${
    typeof valueNode === "string" ? valueNode : ""
  }`.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {subject.kind === "set" ? (
        <ActiveFilterChip
          subject={subject.label}
          clearLabel={t("tasks:filters.removeFilter", {
            subject: subject.label,
          })}
          onClear={() => onChange(null)}
          operator={
            <button
              type="button"
              disabled={readOnly}
              className="h-full px-2 text-foreground/80 hover:bg-accent/60 disabled:hover:bg-transparent"
              onClick={cycleOperator}
            >
              {operator}
            </button>
          }
          value={
            <PopoverTrigger
              disabled={readOnly}
              aria-label={accessibleName}
              className={valueButtonClass}
            >
              {valueNode}
            </PopoverTrigger>
          }
        />
      ) : (
        // Date operators need their own fields, so the operator and the
        // value open one editor.
        <ActiveFilterChip
          subject={subject.label}
          clearLabel={t("tasks:filters.removeFilter", {
            subject: subject.label,
          })}
          onClear={() => onChange(null)}
          operator={
            <PopoverTrigger
              disabled={readOnly}
              aria-label={accessibleName}
              className="flex h-full items-center hover:bg-accent/60 disabled:hover:bg-transparent"
            >
              <span className="px-2 text-foreground/80">{operator}</span>
              {valueNode !== undefined && (
                <>
                  <span className="h-full w-px bg-border" />
                  <span className="px-2 text-foreground">{valueNode}</span>
                </>
              )}
            </PopoverTrigger>
          }
        />
      )}
      <PopoverContent align="start" className="w-auto p-0">
        {editor}
      </PopoverContent>
    </Popover>
  );
}
