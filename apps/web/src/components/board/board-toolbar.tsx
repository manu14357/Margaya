import { PanelsTopLeft, Rows3 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import TaskToolbar, {
  type TaskToolbarStatus,
} from "@/components/task-filters/task-toolbar";
import { useDisplayConfig } from "@/components/task-filters/use-display-config";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import { cn } from "@/lib/cn";
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

function LayoutButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded px-2 font-medium text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-xs"
          : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

/** The Board/List segmented switch. */
export function LayoutToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: "board" | "list";
  setViewMode: (mode: "board" | "list") => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      aria-label={t("tasks:view.layout")}
      className="inline-flex min-w-0 items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      <LayoutButton
        active={viewMode === "board"}
        onClick={() => setViewMode("board")}
        icon={<PanelsTopLeft className="h-3 w-3" />}
        label={t("tasks:view.board")}
      />
      <LayoutButton
        active={viewMode === "list"}
        onClick={() => setViewMode("list")}
        icon={<Rows3 className="h-3 w-3" />}
        label={t("tasks:view.list")}
      />
    </fieldset>
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
