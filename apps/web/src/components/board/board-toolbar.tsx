import { PanelsTopLeft, Rows3 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import TaskToolbar, {
  type TaskToolbarStatus,
} from "@/components/task-filters/task-toolbar";
import { useDisplayConfig } from "@/components/task-filters/use-display-config";
import { Toggle, ToggleGroup } from "@/components/ui/toggle-group";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import type { TaskQueryScope } from "@/lib/task-query/model";

// The filter primitives moved to the task filter bar; planning screens still
// import them from here.
export {
  ActiveFilterChip,
  CheckSlot,
} from "@/components/task-filters/filter-primitives";

type BoardToolbarProps = {
  workspaceId: string;
  projectId: string;
  handle: TaskQueryStateHandle;
  viewMode: "board" | "list";
  setViewMode: (mode: "board" | "list") => void;
  status?: TaskToolbarStatus;
  /** Cycle and module pages keep the classic board: no regrouping. */
  classicOnly?: boolean;
  /** Subjects the page fixes itself (its cycle or module). */
  hiddenSubjects?: readonly string[];
  /** Actions before the layout toggle (Save view). */
  actions?: ReactNode;
  /** False when the page shows the Board/List switch elsewhere (the tab row). */
  showLayoutToggle?: boolean;
};

/**
 * The Board/List switch of a cycle or module page. Icons only: the project's
 * tab row above it already spells out these names.
 */
export function LayoutToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: "board" | "list";
  setViewMode: (mode: "board" | "list") => void;
}) {
  const { t } = useTranslation();
  return (
    <ToggleGroup
      size="sm"
      variant="outline"
      aria-label={t("tasks:view.layout")}
      value={[viewMode]}
      onValueChange={(values) => {
        const next = values[0];
        if (next === "board" || next === "list") setViewMode(next);
      }}
    >
      <Toggle
        value="board"
        aria-label={t("tasks:view.board")}
        title={t("tasks:view.board")}
      >
        <PanelsTopLeft className="h-3 w-3" />
      </Toggle>
      <Toggle
        value="list"
        aria-label={t("tasks:view.list")}
        title={t("tasks:view.list")}
      >
        <Rows3 className="h-3 w-3" />
      </Toggle>
    </ToggleGroup>
  );
}

/** The project board's toolbar: filters, display and the Board/List toggle. */
export default function BoardToolbar({
  workspaceId,
  projectId,
  handle,
  viewMode,
  setViewMode,
  status,
  classicOnly = false,
  hiddenSubjects,
  actions,
  showLayoutToggle = true,
}: BoardToolbarProps) {
  const scope = useMemo<TaskQueryScope>(
    () => ({ kind: "project", projectId }),
    [projectId],
  );
  const displayConfig = useDisplayConfig({
    workspaceId,
    scope,
    layout: viewMode,
    classicOnly,
  });

  return (
    <TaskToolbar
      workspaceId={workspaceId}
      scope={scope}
      handle={handle}
      displayConfig={displayConfig}
      showArchived={!classicOnly}
      hiddenSubjects={hiddenSubjects}
      status={status}
      rightSlot={
        actions || showLayoutToggle ? (
          <>
            {actions}
            {showLayoutToggle && (
              <LayoutToggle viewMode={viewMode} setViewMode={setViewMode} />
            )}
          </>
        ) : undefined
      }
    />
  );
}
