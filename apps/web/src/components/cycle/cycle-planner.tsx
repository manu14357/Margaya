import { Minus, Plus, Search } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { SplitView } from "@/components/common/split-view";
import EstimateProgressSummary from "@/components/estimate/estimate-progress-summary";
import { PlanningPageSkeleton } from "@/components/planning/planning-page-states";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import { useAddCycleTasks } from "@/hooks/mutations/cycle/use-add-cycle-tasks";
import { useRemoveCycleTasks } from "@/hooks/mutations/cycle/use-remove-cycle-tasks";
import { useActiveEstimate } from "@/hooks/queries/estimate/use-active-estimate";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import { formatCycleRange } from "@/lib/cycle/dates";
import { formatEstimateValue } from "@/lib/estimate/format";
import { computeEstimateTotals } from "@/lib/estimate/totals";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import type { ProjectWithTasks } from "@/types/project";
import {
  type PlanTask,
  searchPlan,
  settleOverrides,
  splitPlan,
} from "./cycle-plan-model";
import { CycleStatusBadge } from "./cycle-status";

type Pane = "backlog" | "cycle";

type CyclePlannerProps = {
  cycle: Cycle;
  workspaceId: string;
};

const ROW_SELECTOR = "[data-plan-row]";

function rowsOf(pane: Pane) {
  return [
    ...document.querySelectorAll<HTMLElement>(
      `[data-plan-pane="${pane}"] ${ROW_SELECTOR}`,
    ),
  ];
}

function focusRow(pane: Pane, index: number) {
  const rows = rowsOf(pane);
  if (rows.length === 0) return;
  rows[Math.max(0, Math.min(rows.length - 1, index))]?.focus();
}

/**
 * The split-view cycle planner (§7.4): open backlog tasks on the left, the
 * cycle's tasks on the right. Click, Space or drag moves a task across;
 * moves call the same add and remove endpoints as "Add existing" and the
 * bulk bar, and show at once while the API confirms them.
 */
export default function CyclePlanner({
  cycle,
  workspaceId,
}: CyclePlannerProps) {
  const { t } = useTranslation();
  const projectId = cycle.projectId;
  const { data } = useGetTasks(projectId);
  const board = data as ProjectWithTasks | undefined;
  const addTasks = useAddCycleTasks();
  const removeTasks = useRemoveCycleTasks();
  const { estimate, pointsById, featureEnabled } = useActiveEstimate({
    projectId,
    workspaceId,
  });
  const [overrides, setOverrides] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [query, setQuery] = useState("");
  const [mobilePane, setMobilePane] = useState<Pane>("backlog");
  const [dragging, setDragging] = useState<{ id: string; from: Pane } | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<Pane | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Once the board data agrees with a pending move, the move is settled.
  useEffect(() => {
    setOverrides((previous) => {
      const next = settleOverrides(board, cycle.id, previous);
      return next.size === previous.size ? previous : next;
    });
  }, [board, cycle.id]);

  const { backlog, cycle: planned } = useMemo(
    () => splitPlan(board, cycle.id, overrides),
    [board, cycle.id, overrides],
  );
  const visibleBacklog = searchPlan(backlog, query);
  const totals = useMemo(
    () =>
      computeEstimateTotals(
        planned.map((entry) => entry.task),
        estimate,
        board?.columns ?? [],
        featureEnabled,
      ),
    [planned, estimate, board, featureEnabled],
  );

  const estimateOf = (entry: PlanTask) => {
    const point = entry.task.estimatePointId
      ? pointsById.get(entry.task.estimatePointId)
      : undefined;
    return estimate && point
      ? formatEstimateValue(estimate.type, point.value, { t })
      : null;
  };

  const move = async (entry: PlanTask, from: Pane, index: number) => {
    const id = entry.task.id;
    const to: Pane = from === "backlog" ? "cycle" : "backlog";
    setOverrides((previous) => new Map(previous).set(id, to === "cycle"));
    setAnnouncement(
      to === "cycle"
        ? t("cycles:plan.announceAdded", { key: entry.key, name: cycle.name })
        : t("cycles:plan.announceRemoved", { key: entry.key }),
    );
    // The moved row leaves this pane; keep the keyboard on its neighbour.
    requestAnimationFrame(() => focusRow(from, index));
    try {
      if (to === "cycle") {
        await addTasks.mutateAsync({
          cycleId: cycle.id,
          projectId,
          taskIds: [id],
        });
      } else {
        await removeTasks.mutateAsync({
          projectId,
          taskIdsByCycle: new Map([[cycle.id, [id]]]),
        });
      }
    } catch (error) {
      setOverrides((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
      toast.error(
        (error instanceof Error && error.message) || t("cycles:bulk.error"),
      );
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "/" && !target.closest("input")) {
      event.preventDefault();
      setMobilePane("backlog");
      searchRef.current?.focus();
      return;
    }
    const row = target.closest<HTMLElement>(ROW_SELECTOR);
    if (!row || event.altKey || event.ctrlKey || event.metaKey) return;
    const pane = row.dataset.planSide as Pane;
    const index = rowsOf(pane).indexOf(row);
    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        focusRow(pane, index + 1);
        break;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        focusRow(pane, index - 1);
        break;
      case "ArrowRight":
      case "ArrowLeft": {
        event.preventDefault();
        const other: Pane = event.key === "ArrowRight" ? "cycle" : "backlog";
        if (other !== pane) {
          setMobilePane(other);
          requestAnimationFrame(() => focusRow(other, index));
        }
        break;
      }
    }
  };

  const dropProps = (pane: Pane) => ({
    onDragOver: (event: DragEvent) => {
      if (!dragging || dragging.from === pane) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(pane);
    },
    onDragLeave: (event: DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setDropTarget(null);
      }
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropTarget(null);
      if (!dragging || dragging.from === pane) return;
      const list = dragging.from === "backlog" ? backlog : planned;
      const index = list.findIndex((entry) => entry.task.id === dragging.id);
      const entry = list[index];
      setDragging(null);
      if (entry) void move(entry, dragging.from, index);
    },
  });

  if (!board) return <PlanningPageSkeleton />;

  const renderRows = (
    pane: Pane,
    entries: PlanTask[],
    empty: ReactNode,
  ): ReactNode =>
    entries.length === 0 ? (
      <p className="px-4 py-10 text-center text-muted-foreground text-sm">
        {empty}
      </p>
    ) : (
      <ul className="py-1">
        {entries.map((entry, index) => {
          const estimateLabel = estimateOf(entry);
          const isDragged = dragging?.id === entry.task.id;
          return (
            <li key={entry.task.id}>
              <button
                type="button"
                data-plan-row={entry.task.id}
                data-plan-side={pane}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", entry.key);
                  setDragging({ id: entry.task.id, from: pane });
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                onClick={() => void move(entry, pane, index)}
                aria-label={
                  pane === "backlog"
                    ? t("cycles:plan.addTask", {
                        key: entry.key,
                        title: entry.task.title,
                      })
                    : t("cycles:plan.removeTask", {
                        key: entry.key,
                        title: entry.task.title,
                      })
                }
                className={cn(
                  "group flex h-8 w-full items-center gap-2 px-3 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  isDragged && "opacity-50",
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {getColumnIcon(
                    entry.column.slug,
                    false,
                    entry.column.icon,
                    entry.column.group,
                  )}
                </span>
                <span className="w-16 shrink-0 truncate font-mono text-muted-foreground text-xs">
                  {entry.key}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {entry.task.title}
                </span>
                {estimateLabel && (
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {estimateLabel}
                  </span>
                )}
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {getPriorityIcon(entry.task.priority ?? "")}
                </span>
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {pane === "backlog" ? (
                    <Plus className="size-3.5" />
                  ) : (
                    <Minus className="size-3.5" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  const paneClass = (pane: Pane) =>
    cn(
      "flex min-h-full flex-col",
      dropTarget === pane &&
        "outline-2 outline-primary/40 outline-dashed -outline-offset-4",
    );

  const range = formatCycleRange(cycle.startDate, cycle.endDate);

  const backlogPane = (
    <div
      data-plan-pane="backlog"
      className={paneClass("backlog")}
      {...dropProps("backlog")}
    >
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-border/80 border-b bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("cycles:plan.backlogTitle")}
          </h2>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("cycles:detail.taskCount", { count: backlog.length })}
          </span>
        </div>
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusRow("backlog", 0);
              }
            }}
            placeholder={t("planning:addExisting.searchPlaceholder")}
            aria-label={t("planning:addExisting.searchPlaceholder")}
            className="h-7.5 [&_[data-slot=input]]:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
          />
        </div>
      </div>
      {renderRows(
        "backlog",
        visibleBacklog,
        backlog.length === 0
          ? t("cycles:addExisting.allPlanned")
          : t("cycles:addExisting.noResults"),
      )}
    </div>
  );

  const cyclePane = (
    <div
      data-plan-pane="cycle"
      className={paneClass("cycle")}
      {...dropProps("cycle")}
    >
      <div className="sticky top-0 z-10 flex flex-col gap-2 border-border/80 border-b bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-semibold text-sm">{cycle.name}</h2>
            <CycleStatusBadge cycle={cycle} />
          </div>
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {range ?? t("cycles:badge.noDates")}
          </span>
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {t("cycles:plan.plannedCount", { count: planned.length })}
        </p>
        <EstimateProgressSummary estimates={totals} />
      </div>
      {renderRows("cycle", planned, t("cycles:plan.cycleEmpty"))}
    </div>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow-key navigation between the rows inside
    <div className="flex h-full min-h-0 flex-col" onKeyDown={handleKeyDown}>
      <div className="flex shrink-0 items-center justify-center border-border/80 border-b px-3 py-1.5 lg:hidden">
        <ToggleGroup
          size="sm"
          variant="outline"
          value={[mobilePane]}
          aria-label={t("cycles:plan.paneLabel")}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "backlog" || next === "cycle") setMobilePane(next);
          }}
        >
          <Toggle value="backlog" className="px-2 text-xs">
            {t("cycles:plan.backlogTitle")} · {backlog.length}
          </Toggle>
          <Toggle value="cycle" className="px-2 text-xs">
            {cycle.name} · {planned.length}
          </Toggle>
        </ToggleGroup>
      </div>
      <SplitView
        primaryWidth="half"
        showSecondary={mobilePane === "cycle"}
        primaryLabel={t("cycles:plan.backlogTitle")}
        secondaryLabel={cycle.name}
        primary={backlogPane}
        secondary={cyclePane}
      />
      <div className="hidden h-8 shrink-0 items-center gap-3 border-border/80 border-t px-3 text-muted-foreground text-xs md:flex">
        <span className="inline-flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("cycles:plan.hintMove")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          {t("cycles:plan.hintSwitch")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>{t("cycles:plan.keySpace")}</Kbd>
          {t("cycles:plan.hintToggle")}
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>/</Kbd>
          {t("cycles:plan.hintSearch")}
        </span>
        <span className="ms-auto hidden lg:inline">
          {t("cycles:plan.hintDrag")}
        </span>
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
