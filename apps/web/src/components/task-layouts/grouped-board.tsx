import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useMoveTaskToGroup } from "@/hooks/mutations/task-query/use-move-task-to-group";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { cn } from "@/lib/cn";
import {
  isDraggableGrouping,
  planGroupMove,
} from "@/lib/task-query/group-moves";
import type { MergedTaskQueryResult } from "@/lib/task-query/merge";
import type { DisplayProperties, GroupByKey } from "@/lib/task-query/model";
import { rowToTask } from "@/lib/task-query/row-task";
import { toast } from "@/lib/toast";
import { useGroupPresentation } from "./group-label";
import GroupQuickAdd, { type QuickAddContext } from "./group-quick-add";
import QueryTaskCard, { QueryTaskCardBody } from "./query-task-card";

type GroupedBoardProps = {
  query: TaskQueryHandle;
  data: MergedTaskQueryResult;
  properties: DisplayProperties;
  workspaceId: string;
  /** Status groups need one project to move between. */
  singleProject: boolean;
  canUpdate: boolean;
  canAssign: boolean;
  /** A quick add at the foot of each column or cell; null for none. */
  quickAdd?: QuickAddContext | null;
};

type Place = { group: string; sub: string | null };

type PendingMove = { taskId: string; from: Place; to: Place };

const placeId = (place: Place) => `${place.group}::${place.sub ?? ""}`;

function samePlace(a: Place, b: Place) {
  return a.group === b.group && a.sub === b.sub;
}

function canDragBy(
  groupBy: GroupByKey | null,
  singleProject: boolean,
  canUpdate: boolean,
  canAssign: boolean,
) {
  if (!isDraggableGrouping(groupBy, singleProject)) return false;
  return groupBy === "assignee" ? canAssign : canUpdate;
}

function Cell({
  place,
  children,
  className,
}: {
  place: Place;
  children: ReactNode;
  className?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${placeId(place)}`,
    data: place,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-16 flex-col gap-1.5 rounded-lg p-0.5 transition-colors",
        isOver && "bg-accent/50 outline-2 outline-primary/60 outline-dashed",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Query mode's board: a column per group, swimlanes per sub-group. */
export default function GroupedBoard({
  query,
  data,
  properties,
  workspaceId,
  singleProject,
  canUpdate,
  canAssign,
  quickAdd = null,
}: GroupedBoardProps) {
  const { t } = useTranslation();
  const present = useGroupPresentation();
  const move = useMoveTaskToGroup();
  const [pending, setPending] = useState<PendingMove[]>([]);
  const [active, setActive] = useState<{ taskId: string } | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>(
    {},
  );
  const { groupBy, subGroupBy } = data;

  // Fresh results replace the optimistic moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the data changes
  useEffect(() => {
    setPending([]);
  }, [data]);

  const draggable = canDragBy(groupBy, singleProject, canUpdate, canAssign);
  const subDraggable =
    subGroupBy !== null &&
    canDragBy(subGroupBy, singleProject, canUpdate, canAssign);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const idsAt = (place: Place, base: readonly string[]) => {
    const movedOut = new Set(
      pending
        .filter((entry) => samePlace(entry.from, place))
        .map((entry) => entry.taskId),
    );
    const movedIn = pending
      .filter((entry) => samePlace(entry.to, place))
      .map((entry) => entry.taskId);
    return [
      ...movedIn,
      ...base.filter((id) => !movedOut.has(id) && !movedIn.includes(id)),
    ];
  };

  const laneKeys = useMemo(() => {
    if (!subGroupBy) return [];
    const keys: string[] = [];
    for (const group of data.groups) {
      for (const cell of group.subGroups ?? []) {
        if (!keys.includes(cell.key)) keys.push(cell.key);
      }
    }
    return keys;
  }, [data.groups, subGroupBy]);

  const handleDragEnd = async (event: DragEndEvent) => {
    setActive(null);
    const from = event.active.data.current as
      | (Place & { taskId: string })
      | undefined;
    const to = event.over?.data.current as Place | undefined;
    if (!from || !to || samePlace(from, to)) return;
    const row = data.tasks[from.taskId];
    if (!row) return;
    const actions = [
      from.group !== to.group && draggable
        ? planGroupMove(groupBy, from.group, to.group, data.meta)
        : null,
      from.sub !== to.sub && subDraggable && from.sub && to.sub
        ? planGroupMove(subGroupBy, from.sub, to.sub, data.meta)
        : null,
    ].filter((action) => action !== null);
    if (actions.length === 0) return;
    const entry: PendingMove = {
      taskId: row.id,
      from: { group: from.group, sub: from.sub },
      to,
    };
    setPending((current) => [...current, entry]);
    try {
      for (const action of actions) {
        await move.mutateAsync({ task: rowToTask(row, data.meta), action });
      }
    } catch (error) {
      setPending((current) =>
        current.filter((candidate) => candidate !== entry),
      );
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:groups.moveError"),
      );
    }
  };

  const renderCards = (place: Place, base: readonly string[]) =>
    idsAt(place, base).map((id) => {
      const row = data.tasks[id];
      if (!row) return null;
      return (
        <QueryTaskCard
          key={`${placeId(place)}:${id}`}
          dragId={`drag:${placeId(place)}:${id}`}
          place={place}
          row={row}
          meta={data.meta}
          properties={properties}
          workspaceId={workspaceId}
          draggable={draggable || subDraggable}
        />
      );
    });

  const loadMoreButton = (
    count: number,
    shown: number,
    nextCursor: string | null,
    group: string,
    sub?: string,
  ) =>
    nextCursor ? (
      <Button
        size="xs"
        variant="ghost"
        className="text-muted-foreground"
        loading={query.isLoadingMore(group, sub)}
        onClick={() => query.loadMore(group, sub)}
      >
        {t("tasks:groups.loadMore", { count: Math.max(count - shown, 0) })}
      </Button>
    ) : null;

  const header = (key: string, count: number, by: GroupByKey | null) => {
    const { label, icon } = present(by, key, data.meta);
    return (
      <div className="flex h-7 min-w-0 items-center gap-1.5">
        {icon && (
          <span className="inline-flex size-4 items-center justify-center text-muted-foreground [&>svg]:size-3.5">
            {icon}
          </span>
        )}
        <span className="truncate font-medium text-[13px] text-foreground">
          {label}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {count}
        </span>
      </div>
    );
  };

  const cellQuickAdd = (group: string, sub?: string, className?: string) =>
    quickAdd ? (
      <GroupQuickAdd
        context={quickAdd}
        groupings={[
          { by: groupBy, key: group },
          ...(sub !== undefined ? [{ by: subGroupBy, key: sub }] : []),
        ]}
        meta={data.meta}
        workspaceId={workspaceId}
        className={className}
      />
    ) : null;

  const activeRow = active ? data.tasks[active.taskId] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => {
        const current = event.active.data.current as
          | { taskId: string }
          | undefined;
        if (current) setActive({ taskId: current.taskId });
      }}
      onDragCancel={() => setActive(null)}
      onDragEnd={(event) => void handleDragEnd(event)}
    >
      <div className="flex h-full w-full flex-col">
        <div className="min-h-0 flex-1 overflow-auto [-webkit-overflow-scrolling:touch]">
          {!subGroupBy ? (
            <div className="flex h-full min-w-max gap-2 px-2 py-2 md:gap-3 md:px-3 md:py-3">
              {data.groups.map((group) => {
                const place = { group: group.key, sub: null };
                return (
                  <div
                    key={group.key}
                    className="flex h-full w-[calc(100vw-2rem)] max-w-[296px] shrink-0 flex-col rounded-xl bg-muted/50 md:w-[280px] lg:w-[296px] dark:bg-card/60"
                  >
                    <div className="shrink-0 px-2 pt-1.5 pb-1">
                      {header(group.key, group.count, groupBy)}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
                      <Cell place={place}>
                        {renderCards(place, group.taskIds)}
                        {loadMoreButton(
                          group.count,
                          group.taskIds.length,
                          group.nextCursor,
                          group.key,
                        )}
                      </Cell>
                    </div>
                    {cellQuickAdd(
                      group.key,
                      undefined,
                      "mx-1.5 mb-1.5 w-auto shrink-0",
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="min-w-max space-y-2 px-2 py-2 md:space-y-3 md:px-3 md:py-3">
              <div className="flex gap-3 pl-0">
                {data.groups.map((group) => (
                  <div
                    key={group.key}
                    className="w-[296px] shrink-0 rounded-lg bg-muted/50 px-2 py-0.5 dark:bg-card/60"
                  >
                    {header(group.key, group.count, groupBy)}
                  </div>
                ))}
              </div>
              {laneKeys.map((laneKey) => {
                const collapsed = Boolean(collapsedLanes[laneKey]);
                const laneCount = data.groups.reduce(
                  (sum, group) =>
                    sum +
                    (group.subGroups?.find((cell) => cell.key === laneKey)
                      ?.count ?? 0),
                  0,
                );
                return (
                  <div
                    key={laneKey}
                    className="rounded-xl border border-border/60"
                  >
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedLanes((current) => ({
                          ...current,
                          [laneKey]: !collapsed,
                        }))
                      }
                      className="flex w-full items-center gap-2 border-border/60 border-b bg-muted/50 px-2 py-0.5 text-left"
                    >
                      <ChevronRight
                        className={cn(
                          "size-3 transition-transform",
                          !collapsed && "rotate-90",
                        )}
                      />
                      {header(laneKey, laneCount, subGroupBy)}
                    </button>
                    {!collapsed && (
                      <div className="flex gap-3 p-1.5">
                        {data.groups.map((group) => {
                          const cell = group.subGroups?.find(
                            (candidate) => candidate.key === laneKey,
                          );
                          const place = { group: group.key, sub: laneKey };
                          return (
                            <div key={group.key} className="w-[296px] shrink-0">
                              <Cell place={place}>
                                {renderCards(place, cell?.taskIds ?? [])}
                                {cell &&
                                  loadMoreButton(
                                    cell.count,
                                    cell.taskIds.length,
                                    cell.nextCursor,
                                    group.key,
                                    laneKey,
                                  )}
                              </Cell>
                              {cellQuickAdd(group.key, laneKey, "mt-1")}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <DragOverlay>
        {activeRow ? (
          <div className="rotate-1 scale-[1.03] rounded-lg border border-border bg-background px-2.5 py-2 shadow-lg ring-2 ring-ring/35">
            <div className="relative">
              <QueryTaskCardBody
                row={activeRow}
                meta={data.meta}
                properties={properties}
              />
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
