import { type ComponentProps, useMemo } from "react";
import { ErrorDisplay } from "@/components/ui/error-display";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { DisplayProperties } from "@/lib/task-query/model";
import type { QuickAddContext } from "./group-quick-add";
import GroupedBoard from "./grouped-board";
import GroupedList from "./grouped-list";
import { QueryEmpty, QueryRowsSkeleton } from "./query-states";
import { useCreatedTaskCheck } from "./use-created-task-check";

type TaskQueryViewProps = {
  query: TaskQueryHandle;
  layout: "list" | "board";
  properties: DisplayProperties;
  workspaceId: string;
  /** Keeps each list's open and closed sections apart. */
  storageKey: string;
  singleProject: boolean;
  onClearFilters?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  /** List layout only: the end of each row (see QueryTaskRow). */
  rowEnd?: ComponentProps<typeof GroupedList>["rowEnd"];
  /** Offer a quick add at the foot of each group (with task:create). */
  quickAdd?: boolean;
  /** The list's own project; cross-project lists add only in project groups. */
  projectId?: string;
};

/** Query mode: a grouped list or board over task query rows (B4 §6.6). */
export default function TaskQueryView({
  query,
  layout,
  properties,
  workspaceId,
  storageKey,
  singleProject,
  onClearFilters,
  emptyTitle,
  emptyDescription,
  rowEnd,
  quickAdd = false,
  projectId,
}: TaskQueryViewProps) {
  const {
    canUpdateTasks,
    canAssignTasks,
    canCreateTasks,
    canUpdateCycles,
    canUpdateModules,
  } = useWorkspacePermission();
  const { data } = query;
  const checkCreated = useCreatedTaskCheck(query, workspaceId);
  const canCreate = quickAdd && canCreateTasks();
  const updateCycles = canUpdateCycles();
  const updateModules = canUpdateModules();
  const updateTasks = canUpdateTasks();
  const quickAddContext = useMemo<QuickAddContext | null>(
    () =>
      canCreate
        ? {
            scopeProjectId: projectId ?? null,
            can: { updateCycles, updateModules, updateTasks },
            onCreated: (task) => void checkCreated(task),
          }
        : null,
    [
      canCreate,
      projectId,
      updateCycles,
      updateModules,
      updateTasks,
      checkCreated,
    ],
  );

  if (!data) {
    if (query.isError) {
      return (
        <div className="p-4">
          <ErrorDisplay
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </div>
      );
    }
    return <QueryRowsSkeleton />;
  }

  if (data.totalCount === 0 && !data.groups.some((group) => group.count > 0)) {
    const showsEmptyGroups = data.groups.length > 0 && Boolean(data.groupBy);
    if (!showsEmptyGroups || layout === "list") {
      return (
        <QueryEmpty
          onClear={onClearFilters}
          title={emptyTitle}
          description={emptyDescription}
        />
      );
    }
  }

  return layout === "board" ? (
    <GroupedBoard
      query={query}
      data={data}
      properties={properties}
      workspaceId={workspaceId}
      singleProject={singleProject}
      canUpdate={canUpdateTasks()}
      canAssign={canAssignTasks()}
      quickAdd={quickAddContext}
    />
  ) : (
    <GroupedList
      query={query}
      data={data}
      properties={properties}
      workspaceId={workspaceId}
      storageKey={storageKey}
      rowEnd={rowEnd}
      quickAdd={quickAddContext}
    />
  );
}
