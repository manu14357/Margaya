import { removeRootCondition, setRootCondition } from "./filter-tree";
import {
  DATE_PRESETS,
  type DatePreset,
  type FilterCondition,
  type FilterNode,
  NONE_VALUE,
} from "./model";

// Date filter presets, operators and the "Overdue" convenience row.

/** Presets in menu order; `none` reads "No date" and comes last. */
export const DATE_PRESET_ORDER: readonly DatePreset[] = DATE_PRESETS;

export const DATE_PRESET_LABEL_KEYS: Record<DatePreset, string> = {
  today: "tasks:filters.dates.today",
  yesterday: "tasks:filters.dates.yesterday",
  tomorrow: "tasks:filters.dates.tomorrow",
  thisWeek: "tasks:filters.dates.thisWeek",
  lastWeek: "tasks:filters.dates.lastWeek",
  nextWeek: "tasks:filters.dates.nextWeek",
  thisMonth: "tasks:filters.dates.thisMonth",
  lastMonth: "tasks:filters.dates.lastMonth",
  nextMonth: "tasks:filters.dates.nextMonth",
  past: "tasks:filters.dates.past",
  future: "tasks:filters.dates.future",
  none: "tasks:filters.values.none",
};

export const DATE_OPERATOR_LABEL_KEYS: Record<string, string> = {
  in: "tasks:boardFilters.operators.isAnyOf",
  on: "tasks:filters.operators.on",
  onOrBefore: "tasks:filters.operators.onOrBefore",
  onOrAfter: "tasks:filters.operators.onOrAfter",
  between: "tasks:filters.operators.between",
  withinLast: "tasks:filters.operators.withinLast",
  withinNext: "tasks:filters.operators.withinNext",
  moreThanAgo: "tasks:filters.operators.moreThanAgo",
  moreThanAhead: "tasks:filters.operators.moreThanAhead",
  empty: "tasks:filters.operators.isEmpty",
  notEmpty: "tasks:filters.operators.isNotEmpty",
};

/** Presets future-facing keys offer; created/updated/completed look back. */
export function presetsForKey(key: string): readonly DatePreset[] {
  if (key === "createdAt" || key === "updatedAt") {
    return DATE_PRESET_ORDER.filter(
      (preset) =>
        preset !== "tomorrow" &&
        preset !== "nextWeek" &&
        preset !== "nextMonth" &&
        preset !== "future" &&
        preset !== NONE_VALUE,
    );
  }
  if (key === "completedAt") {
    return DATE_PRESET_ORDER.filter(
      (preset) =>
        preset !== "tomorrow" &&
        preset !== "nextWeek" &&
        preset !== "nextMonth" &&
        preset !== "future",
    );
  }
  return DATE_PRESET_ORDER;
}

/** Open work (backlog, unstarted, started) that is due before today. */
export const OVERDUE_CONDITIONS: readonly FilterCondition[] = [
  { key: "dueDate", operator: "in", values: ["past"] },
  {
    key: "group",
    operator: "in",
    values: ["backlog", "unstarted", "started"],
  },
];

function sameCondition(a: FilterCondition | undefined, b: FilterCondition) {
  if (!a) return false;
  return (
    a.operator === b.operator &&
    JSON.stringify([...(a.values ?? [])].sort()) ===
      JSON.stringify([...(b.values ?? [])].sort())
  );
}

/** True when both "Overdue" conditions are set exactly. */
export function isOverdueActive(
  conditions: readonly FilterCondition[],
): boolean {
  return OVERDUE_CONDITIONS.every((expected) =>
    sameCondition(
      conditions.find((condition) => condition.key === expected.key),
      expected,
    ),
  );
}

/** Sets or clears the "Overdue" pair. */
export function toggleOverdue(
  root: FilterNode | null,
  conditions: readonly FilterCondition[],
): FilterNode | null {
  if (isOverdueActive(conditions)) {
    let next = root;
    for (const condition of OVERDUE_CONDITIONS) {
      next = removeRootCondition(next, condition.key);
    }
    return next;
  }
  let next = root;
  for (const condition of OVERDUE_CONDITIONS) {
    next = setRootCondition(next, {
      ...condition,
      values: [...(condition.values ?? [])],
    });
  }
  return next;
}

/** YYYY-MM-DD of a local calendar day. */
export function toDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The local Date of a YYYY-MM-DD day, or undefined. */
export function fromDayString(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
