import type { ComponentProps } from "react";
import { ErrorDisplay } from "@/components/ui/error-display";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { DisplayProperties } from "@/lib/task-query/model";
import GroupedBoard from "./grouped-board";
import GroupedList from "./grouped-list";
import { QueryEmpty, QueryRowsSkeleton } from "./query-states";

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
}: TaskQueryViewProps) {
  const { canUpdateTasks, canAssignTasks } = useWorkspacePermission();
  const { data } = query;

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
    />
  ) : (
    <GroupedList
      query={query}
      data={data}
      properties={properties}
      workspaceId={workspaceId}
      storageKey={storageKey}
      rowEnd={rowEnd}
    />
  );
}
