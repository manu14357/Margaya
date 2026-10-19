import { Filter, ListFilter } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import AiFilterButton from "@/components/ai/filters/ai-filter-button";
import { FilterBar } from "@/components/common/filter-bar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import { cn } from "@/lib/cn";
import {
  allConditions,
  conditionId,
  isNestedTree,
  removeRootCondition,
  rootConditions,
  rootOp,
  setRootCondition,
  setRootOp,
} from "@/lib/task-query/filter-tree";
import {
  type FilterCondition,
  isDateFilterKey,
  type TaskQueryScope,
} from "@/lib/task-query/model";
import { toast } from "@/lib/toast";
import DateConditionEditor from "./date-condition-editor";
import DisplayMenu, { type DisplayMenuConfig } from "./display-menu";
import FilterChip from "./filter-chip";
import FilterMenu from "./filter-menu";
import { ActiveFilterChip } from "./filter-primitives";
import MatchPill from "./match-pill";
import {
  type FilterSubject,
  type ScopeProject,
  useFilterSubjects,
} from "./subjects";

export type TaskToolbarStatus = {
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** ids mode matched more than it can return: the board stays unfiltered. */
  truncated?: boolean;
};

type TaskToolbarProps = {
  workspaceId: string;
  scope: TaskQueryScope;
  handle: TaskQueryStateHandle;
  /** Null hides the Display menu. */
  displayConfig?: DisplayMenuConfig | null;
  /** The archived radio (hidden where archived tasks have their own list). */
  showArchived?: boolean;
  /** Subjects the page fixes itself (a cycle page's cycle). */
  hiddenSubjects?: readonly string[];
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  status?: TaskToolbarStatus;
};

function fallbackSubject(condition: FilterCondition): FilterSubject {
  return {
    id: conditionId(condition),
    key: condition.key,
    fieldId: condition.fieldId,
    label: condition.key,
    icon: Filter,
    kind: isDateFilterKey(condition.key) ? "date" : "set",
    options: [],
  };
}

/** A date subject picked from the menu: its editor opens before it exists. */
function DraftDateChip({
  subject,
  onChange,
  onClose,
}: {
  subject: FilterSubject;
  onChange: (condition: FilterCondition | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onClose();
      }}
    >
      <ActiveFilterChip
        subject={subject.label}
        className="border-dashed"
        clearLabel={t("tasks:filters.removeFilter", { subject: subject.label })}
        onClear={onClose}
        operator={
          <PopoverTrigger className="h-full px-2 text-muted-foreground">
            …
          </PopoverTrigger>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <DateConditionEditor
          subjectKey={subject.key}
          condition={undefined}
          onChange={(condition) => {
            onChange(condition);
            if (condition) onClose();
          }}
          onDone={onClose}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The strip under a task list's header: Filter and Display menus, the match
 * pill, the active filter chips and the page's own actions on the right.
 */
export default function TaskToolbar({
  workspaceId,
  scope,
  handle,
  displayConfig,
  showArchived = true,
  hiddenSubjects = [],
  leftSlot,
  rightSlot,
  status,
}: TaskToolbarProps) {
  const { t } = useTranslation();
  const { data: allProjects } = useGetProjects({ workspaceId });
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editing, setEditing] = useState<FilterSubject | null>(null);
  const { filters, archived } = handle;
  const nested = isNestedTree(filters);
  const conditions = nested ? allConditions(filters) : rootConditions(filters);

  const projects = useMemo<ScopeProject[]>(() => {
    const list = (allProjects ?? []) as Array<
      ScopeProject & { archivedAt?: string | null }
    >;
    if (scope.kind === "project") {
      return list.filter((project) => project.id === scope.projectId);
    }
    if (scope.projectIds?.length) {
      return list.filter((project) => scope.projectIds?.includes(project.id));
    }
    return list.filter((project) => !project.archivedAt);
  }, [allProjects, scope]);

  const activeKeys = useMemo(
    () => new Set(conditions.map((condition) => condition.key)),
    [conditions],
  );
  const isActive = useCallback(
    (key: string) => menuOpen || activeKeys.has(key),
    [menuOpen, activeKeys],
  );

  const allSubjects = useFilterSubjects({
    workspaceId,
    scope,
    projects,
    isActive,
  });
  const subjects = allSubjects.filter(
    (subject) => !hiddenSubjects.includes(subject.key),
  );

  const subjectFor = (condition: FilterCondition) =>
    allSubjects.find((subject) => subject.id === conditionId(condition)) ??
    fallbackSubject(condition);

  const changeCondition = (
    condition: FilterCondition,
    next: FilterCondition | null,
  ) => {
    handle.setFilters((previous) =>
      next
        ? setRootCondition(previous, next)
        : removeRootCondition(previous, condition.key, condition.fieldId),
    );
  };

  // A failed request toasts once; the chips keep their state.
  const error = status?.error;
  useEffect(() => {
    if (error) toast.error(t("tasks:filters.applyError"));
  }, [error, t]);

  const chips = conditions.map((condition) => (
    <FilterChip
      key={conditionId(condition)}
      subject={subjectFor(condition)}
      condition={condition}
      readOnly={nested}
      onChange={(next) => changeCondition(condition, next)}
    />
  ));

  const draft =
    editing &&
    !conditions.some((condition) => condition.key === editing.key) ? (
      <DraftDateChip
        key={`draft:${editing.id}`}
        subject={editing}
        onChange={(next) => {
          if (next)
            handle.setFilters((previous) => setRootCondition(previous, next));
        }}
        onClose={() => setEditing(null)}
      />
    ) : null;

  const showMatchPill = !nested && conditions.length >= 2;

  const displayMenu = displayConfig ? (
    <DisplayMenu
      display={handle.display}
      onDisplayChange={handle.updateDisplay}
      displayProperties={handle.displayProperties}
      onPropertyChange={handle.setDisplayProperty}
      onCustomFieldsChange={
        displayConfig.customFields?.length
          ? handle.setCustomFieldColumns
          : undefined
      }
      config={displayConfig}
    />
  ) : null;

  // The lens bar (DESIGN-SYSTEM §6): Filter and the chips on the left, the
  // page's actions and Display on the right.
  return (
    <div className="relative shrink-0">
      <FilterBar
        trailing={
          rightSlot || displayMenu ? (
            <>
              {rightSlot}
              {displayMenu}
            </>
          ) : undefined
        }
      >
        {leftSlot}
        <FilterMenu
          subjects={subjects}
          filters={filters}
          onFiltersChange={(next) => handle.setFilters(next)}
          archived={archived}
          onArchivedChange={showArchived ? handle.setArchived : undefined}
          hasActiveFilters={handle.hasActiveFilters}
          onClear={handle.clearFilters}
          onOpenChange={setMenuOpen}
          onEditDate={(subject) => setEditing(subject)}
          disabled={nested}
        />
        <AiFilterButton
          workspaceId={workspaceId}
          scope={scope}
          onApply={(next) => handle.setFilters(next)}
        />

        {conditions.length > 0 && (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-foreground text-xs sm:hidden"
          >
            <ListFilter className="h-3 w-3" />
            {t("tasks:filters.mobileSummary", { count: conditions.length })}
          </button>
        )}

        {(showMatchPill || chips.length > 0 || draft) && (
          <span
            aria-hidden
            className="mx-0.5 hidden h-4 w-px shrink-0 bg-border sm:block"
          />
        )}
        <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {showMatchPill && (
            <MatchPill
              op={rootOp(filters)}
              onChange={(op) =>
                handle.setFilters((previous) => setRootOp(previous, op))
              }
            />
          )}
          {chips}
          {draft}
        </div>
        <div className="shrink-0 sm:hidden">{draft}</div>

        {archived !== "exclude" && showArchived && (
          <ActiveFilterChip
            subject={t("tasks:filters.archived.label")}
            operator={t(`tasks:filters.archived.${archived}`)}
            clearLabel={t("tasks:filters.removeFilter", {
              subject: t("tasks:filters.archived.label"),
            })}
            onClear={() => handle.setArchived("exclude")}
          />
        )}

        {nested && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {t("tasks:filters.nestedReadOnly")}{" "}
            <button
              type="button"
              className="underline"
              onClick={handle.clearFilters}
            >
              {t("tasks:filters.clearAll")}
            </button>
          </span>
        )}

        {status?.truncated && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {t("tasks:filters.tooMany")}
          </span>
        )}

        {Boolean(error) && status?.onRetry && (
          <span className="shrink-0 text-destructive text-xs">
            {t("tasks:filters.applyError")}{" "}
            <button
              type="button"
              className="underline"
              onClick={status.onRetry}
            >
              {t("tasks:filters.retry")}
            </button>
          </span>
        )}
      </FilterBar>
      <div
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-0.5 overflow-hidden",
          status?.isFetching ? "bg-primary/10" : "bg-transparent",
        )}
      >
        {status?.isFetching && (
          <div className="h-full w-full animate-pulse bg-primary/50" />
        )}
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="p-4">
          <SheetTitle className="mb-3 text-sm">
            {t("tasks:filters.mobileSummary", { count: conditions.length })}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {showMatchPill && (
              <MatchPill
                op={rootOp(filters)}
                onChange={(op) =>
                  handle.setFilters((previous) => setRootOp(previous, op))
                }
              />
            )}
            {chips}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
