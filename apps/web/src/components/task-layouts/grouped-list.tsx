import { ChevronRight } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  useEffect,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import {
  isBooleanRecord,
  useStoredState,
} from "@/components/planning/use-stored-state";
import { Button } from "@/components/ui/button";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { cn } from "@/lib/cn";
import type { CaptureGrouping } from "@/lib/task-query/capture-target";
import type {
  MergedGroup,
  MergedSubGroup,
  MergedTaskQueryResult,
} from "@/lib/task-query/merge";
import type { DisplayProperties, GroupByKey } from "@/lib/task-query/model";
import useBulkSelectionStore from "@/store/bulk-selection";
import { useGroupPresentation } from "./group-label";
import GroupQuickAdd, { type QuickAddContext } from "./group-quick-add";
import QueryTaskRow from "./query-task-row";

type GroupedListProps = {
  query: TaskQueryHandle;
  data: MergedTaskQueryResult;
  properties: DisplayProperties;
  workspaceId: string;
  /** Keeps each list's open and closed sections apart. */
  storageKey: string;
  rowEnd?: ComponentProps<typeof QueryTaskRow>["rowEnd"];
  /** A quick add at the foot of each group; null for none. */
  quickAdd?: QuickAddContext | null;
};

const EMPTY_STATE: Record<string, boolean> = {};

function LoadMore({
  remaining,
  isLoading,
  onClick,
}: {
  remaining: number;
  isLoading: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-1.5">
      <Button
        size="xs"
        variant="ghost"
        loading={isLoading}
        className="text-muted-foreground"
        onClick={onClick}
      >
        {t("tasks:groups.loadMore", { count: remaining })}
      </Button>
    </div>
  );
}

function Section({
  sectionKey,
  groupBy,
  group,
  depth,
  collapsed,
  onToggle,
  children,
  data,
}: {
  sectionKey: string;
  groupBy: GroupByKey | null;
  group: MergedGroup | MergedSubGroup;
  depth: number;
  collapsed: boolean;
  onToggle: (key: string) => void;
  children: React.ReactNode;
  data: MergedTaskQueryResult;
}) {
  const present = useGroupPresentation();
  const { label, icon, tone } = present(groupBy, group.key, data.meta);
  return (
    <div className="border-border/50 border-b">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onToggle(sectionKey)}
        className={cn(
          "sticky z-10 flex h-8 w-full items-center gap-1.5 border-border/50 border-b text-left font-medium text-[13px] text-foreground",
          !tone &&
            "bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/70",
          !tone && depth > 0 && "bg-muted/40",
          tone && "shadow-[inset_3px_0_0_var(--group-color)]",
        )}
        style={
          {
            paddingLeft: 12 + depth * 16,
            paddingRight: 12,
            top: depth * 32,
            ...(tone && {
              "--group-color": tone.color,
              backgroundColor: tone.tint,
            }),
          } as CSSProperties
        }
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        {icon && (
          <span className="inline-flex size-4 items-center justify-center [&>svg]:size-3.5">
            {icon}
          </span>
        )}
        <span className="truncate">{label}</span>
        <span
          className={cn(
            "rounded-full bg-card px-1.5 font-medium text-[11px] tabular-nums leading-4 ring-1",
            tone
              ? "ring-(--group-color)/30"
              : "text-muted-foreground ring-border",
          )}
          style={tone ? { color: tone.foreground } : undefined}
        >
          {group.count}
        </span>
      </button>
      {!collapsed && children}
    </div>
  );
}

/** Query mode's list: one collapsible section per group (B4 §6.6). */
export default function GroupedList({
  query,
  data,
  properties,
  workspaceId,
  storageKey,
  rowEnd,
  quickAdd = null,
}: GroupedListProps) {
  const { t } = useTranslation();
  const [collapsedMap, setCollapsedMap] = useStoredState<
    Record<string, boolean>
  >(`margaya:task-groups:${storageKey}`, EMPTY_STATE, isBooleanRecord);
  const setAvailableTasks = useBulkSelectionStore(
    (state) => state.setAvailableTasks,
  );

  const toggle = (key: string) =>
    setCollapsedMap({ ...collapsedMap, [key]: !collapsedMap[key] });

  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of data.groups) {
      if (collapsedMap[group.key]) continue;
      if (group.subGroups) {
        for (const cell of group.subGroups) {
          if (!collapsedMap[`${group.key}/${cell.key}`])
            ids.push(...cell.taskIds);
        }
      } else {
        ids.push(...group.taskIds);
      }
    }
    return [...new Set(ids)];
  }, [data.groups, collapsedMap]);

  useEffect(() => {
    setAvailableTasks(visibleIds);
  }, [visibleIds, setAvailableTasks]);

  const rows = (ids: readonly string[]) =>
    ids.map((id) => {
      const row = data.tasks[id];
      return row ? (
        <QueryTaskRow
          key={id}
          row={row}
          meta={data.meta}
          properties={properties}
          workspaceId={workspaceId}
          rowEnd={rowEnd}
        />
      ) : null;
    });

  const groupQuickAdd = (groupings: readonly CaptureGrouping[]) =>
    quickAdd ? (
      <GroupQuickAdd
        context={quickAdd}
        groupings={groupings}
        meta={data.meta}
        workspaceId={workspaceId}
        className="mx-1.5 my-1 w-auto md:mx-2.5"
      />
    ) : null;

  const ungrouped = !data.groupBy;
  const hiddenGroups = data.groups.filter(
    (group) =>
      group.count > 0 && group.taskIds.length === 0 && !group.subGroups,
  ).length;

  return (
    <div className="h-full w-full overflow-auto bg-background pb-24">
      {data.groups.map((group) => {
        const groupRows = group.subGroups ? (
          group.subGroups.map((cell) => {
            const cellKey = `${group.key}/${cell.key}`;
            return (
              <Section
                key={cellKey}
                sectionKey={cellKey}
                groupBy={data.subGroupBy}
                group={cell}
                depth={1}
                collapsed={Boolean(collapsedMap[cellKey])}
                onToggle={toggle}
                data={data}
              >
                <div className="bg-card">
                  {rows(cell.taskIds)}
                  {cell.nextCursor && (
                    <LoadMore
                      remaining={cell.count - cell.taskIds.length}
                      isLoading={query.isLoadingMore(group.key, cell.key)}
                      onClick={() => query.loadMore(group.key, cell.key)}
                    />
                  )}
                  {groupQuickAdd([
                    { by: data.groupBy, key: group.key },
                    { by: data.subGroupBy, key: cell.key },
                  ])}
                </div>
              </Section>
            );
          })
        ) : (
          <div className="bg-card">
            {rows(group.taskIds)}
            {group.taskIds.length === 0 && (
              <div className="px-4 py-6 text-center text-muted-foreground text-xs">
                {t("tasks:listView.noTasks")}
              </div>
            )}
            {group.nextCursor && (
              <LoadMore
                remaining={group.count - group.taskIds.length}
                isLoading={query.isLoadingMore(group.key)}
                onClick={() => query.loadMore(group.key)}
              />
            )}
            {groupQuickAdd([{ by: data.groupBy, key: group.key }])}
          </div>
        );
        if (ungrouped) return <div key={group.key}>{groupRows}</div>;
        return (
          <Section
            key={group.key}
            sectionKey={group.key}
            groupBy={data.groupBy}
            group={group}
            depth={0}
            collapsed={Boolean(collapsedMap[group.key])}
            onToggle={toggle}
            data={data}
          >
            {groupRows}
          </Section>
        );
      })}
      {data.hasMoreGroups && hiddenGroups > 0 && (
        <p className="px-4 py-3 text-muted-foreground text-xs">
          {t("tasks:groups.hiddenGroups", { count: hiddenGroups })}
        </p>
      )}
    </div>
  );
}
