import { useState } from "react";
import CaptureBar from "@/components/task-draft/capture-bar";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
  capture?: boolean;
};

/** A board column: a muted well with its header, cards and capture bar. */
function Column({
  column,
  disableDragDrop = false,
  capture = false,
}: ColumnProps) {
  const [isDropzoneOver, setIsDropzoneOver] = useState(false);
  const project = useProjectStore((state) => state.project);
  const { canCreateTasks } = useWorkspacePermission();
  const canCreate = canCreateTasks();

  return (
    // A named section is a region landmark, so each column can be found by
    // its name.
    <section
      aria-label={column.name}
      data-drop={isDropzoneOver || undefined}
      className={cn(
        "group relative flex h-full min-h-0 w-full flex-col rounded-xl bg-muted/50 outline-offset-[-2px] transition-[background-color,outline-color] duration-150 dark:bg-card/60",
        isDropzoneOver &&
          "bg-accent/50 outline-2 outline-primary/60 outline-dashed",
      )}
    >
      <div className="shrink-0 px-2 pt-1.5 pb-1">
        <ColumnHeader column={column} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-1 [-webkit-overflow-scrolling:touch]">
        <ColumnDropzone
          column={column}
          disableDragDrop={disableDragDrop}
          onIsOverChange={setIsDropzoneOver}
        />
      </div>
      {capture && canCreate && project && (
        <div className="shrink-0 px-1.5 pb-1.5">
          <CaptureBar
            projectId={project.id}
            workspaceId={project.workspaceId}
            status={column.slug}
            statusName={column.name}
          />
        </div>
      )}
    </section>
  );
}

export default Column;
