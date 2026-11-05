import { useState } from "react";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import CaptureBar from "@/components/task-draft/capture-bar";
import { focusCapture } from "@/components/task-draft/capture-store";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { useCanBulkSelect } from "../../bulk-selection/selection-checkbox";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";
import type { ColumnTone } from "./column-tone";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
  /** The column's status colour, used only by the header's dot. */
  tone?: ColumnTone;
  disableDragDrop?: boolean;
  capture?: boolean;
};

/** A board column: a muted well with its header, cards and capture bar. */
function Column({
  column,
  tone,
  disableDragDrop = false,
  capture = false,
}: ColumnProps) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const project = useProjectStore((state) => state.project);
  const { canCreateTasks } = useWorkspacePermission();
  const canCreate = canCreateTasks();
  const selectable = useCanBulkSelect();
  const hasCapture = capture && canCreate && Boolean(project);

  const addTask = () => {
    if (hasCapture && project) focusCapture(project.id, column.slug);
    else setIsTaskModalOpen(true);
  };

  return (
    // A named section is a region landmark, so each column can be found by
    // its name.
    <section
      aria-label={column.name}
      data-board-column
      data-drop={isDropTarget || undefined}
      data-tone={tone?.name}
      style={tone?.style}
      className={cn(
        "group relative flex h-full min-h-0 w-full flex-col rounded-xl bg-muted/50 outline-offset-[-2px] transition-[background-color,outline-color] duration-150 dark:bg-card/60",
        isDropTarget && "outline-2 outline-dashed outline-foreground/20",
      )}
    >
      <div className="shrink-0 px-2 pt-1.5 pb-1">
        <ColumnHeader
          column={column}
          canCreate={canCreate}
          onAddTask={() => setIsTaskModalOpen(true)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-1 [-webkit-overflow-scrolling:touch]">
        <ColumnDropzone
          column={column}
          disableDragDrop={disableDragDrop}
          onDropTargetChange={setIsDropTarget}
          onAddTask={canCreate ? addTask : undefined}
          selectable={selectable}
        />
      </div>
      {hasCapture && project && (
        <div className="shrink-0 px-1.5 pb-1.5">
          <CaptureBar
            projectId={project.id}
            workspaceId={project.workspaceId}
            status={column.slug}
            statusName={column.name}
          />
        </div>
      )}

      <CreateTaskModal
        open={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        projectId={project?.id}
        status={column.id}
      />
    </section>
  );
}

export default Column;
