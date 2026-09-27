import { CalendarRange, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  DATE_PRESET_LABEL_KEYS,
  isOverdueActive,
  presetsForKey,
  toggleOverdue,
} from "@/lib/task-query/date-presets";
import {
  findRootCondition,
  removeRootCondition,
  rootConditions,
  setRootCondition,
  toggleConditionValue,
} from "@/lib/task-query/filter-tree";
import type { ArchivedFilter, FilterNode } from "@/lib/task-query/model";
import FilterOptionList from "./filter-option-list";
import { FilterOptionRow } from "./filter-primitives";
import type { FilterSubject } from "./subjects";

type FilterMenuProps = {
  subjects: FilterSubject[];
  filters: FilterNode | null;
  onFiltersChange: (filters: FilterNode | null) => void;
  archived: ArchivedFilter;
  onArchivedChange?: (archived: ArchivedFilter) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
  onOpenChange?: (open: boolean) => void;
  /** Opens the date editor of a subject (its chip). */
  onEditDate: (subject: FilterSubject) => void;
  disabled?: boolean;
};

const ARCHIVED_OPTIONS: ArchivedFilter[] = ["exclude", "include", "only"];

function SelectedCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground">
      {count}
    </span>
  );
}

function DateSubjectRows({
  subject,
  filters,
  onFiltersChange,
  onEditDate,
}: {
  subject: FilterSubject;
  filters: FilterNode | null;
  onFiltersChange: (filters: FilterNode | null) => void;
  onEditDate: (subject: FilterSubject) => void;
}) {
  const { t } = useTranslation();
  const condition = findRootCondition(filters, subject.key);
  const presets = condition?.operator === "in" ? (condition.values ?? []) : [];
  const conditions = rootConditions(filters);

  const togglePreset = (preset: string) => {
    const next = presets.includes(preset)
      ? presets.filter((value) => value !== preset)
      : [...presets, preset];
    onFiltersChange(
      next.length > 0
        ? setRootCondition(filters, {
            key: subject.key,
            operator: "in",
            values: next,
          })
        : removeRootCondition(filters, subject.key),
    );
  };

  return (
    <div className="grid max-h-80 grid-cols-1 gap-0.5 overflow-y-auto p-1">
      {subject.key === "dueDate" && (
        <FilterOptionRow
          checked={isOverdueActive(conditions)}
          label={t("tasks:filters.dates.overdue")}
          onClick={() => onFiltersChange(toggleOverdue(filters, conditions))}
        />
      )}
      {presetsForKey(subject.key).map((preset) => (
        <FilterOptionRow
          key={preset}
          checked={presets.includes(preset)}
          label={t(DATE_PRESET_LABEL_KEYS[preset])}
          onClick={() => togglePreset(preset)}
        />
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="h-7 rounded-md text-xs"
        onClick={() => onEditDate(subject)}
      >
        <CalendarRange className="size-3.5" />
        {t("tasks:filters.dates.custom")}
      </DropdownMenuItem>
    </div>
  );
}

/** The Filter menu: one submenu per subject, archived, clear (B4 §1.2). */
export default function FilterMenu({
  subjects,
  filters,
  onFiltersChange,
  archived,
  onArchivedChange,
  hasActiveFilters,
  onClear,
  onOpenChange,
  onEditDate,
  disabled,
}: FilterMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-foreground text-xs outline-none ring-0 hover:bg-accent/60 disabled:opacity-60"
          />
        }
      >
        <Filter className="h-3 w-3" />
        {t("tasks:filters.button")}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
            {t("tasks:boardFilters.filterBy")}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {subjects.map((subject) => {
          const condition = findRootCondition(
            filters,
            subject.key,
            subject.fieldId,
          );
          const Icon = subject.icon;
          const count =
            subject.kind === "set"
              ? (condition?.values?.length ?? 0)
              : condition
                ? 1
                : 0;
          return (
            <DropdownMenuSub key={subject.id}>
              <DropdownMenuSubTrigger className="h-8 rounded-md text-sm">
                <span className="flex flex-1 items-center gap-2">
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{subject.label}</span>
                  <SelectedCount count={count} />
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {subject.kind === "date" ? (
                  <DateSubjectRows
                    subject={subject}
                    filters={filters}
                    onFiltersChange={onFiltersChange}
                    onEditDate={onEditDate}
                  />
                ) : (
                  <FilterOptionList
                    subject={subject}
                    selected={condition?.values ?? []}
                    onToggle={(value) =>
                      onFiltersChange(
                        toggleConditionValue(
                          filters,
                          subject.key,
                          value,
                          subject.fieldId,
                        ),
                      )
                    }
                  />
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}

        {onArchivedChange && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                {t("tasks:filters.archived.label")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={archived}
                onValueChange={(value) =>
                  onArchivedChange(value as ArchivedFilter)
                }
              >
                {ARCHIVED_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem
                    key={option}
                    value={option}
                    className="h-8 text-sm"
                  >
                    {t(`tasks:filters.archived.${option}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </>
        )}

        {hasActiveFilters && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onClear}
              className="h-8 rounded-md text-muted-foreground text-sm"
            >
              {t("tasks:filters.clearAll")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
