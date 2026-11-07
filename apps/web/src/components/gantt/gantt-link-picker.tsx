import type { JSX } from "react";
import TaskRelationPicker from "@/components/task/task-relation-picker";
import useGetTaskRelations from "@/hooks/queries/task-relation/use-get-task-relations";
import type { RelationLike } from "@/lib/task-relations";

type GanttLinkPickerProps = {
  taskId: string;
  projectId: string;
  workspaceId: string;
  onClose: () => void;
};

/**
 * Linking from a bar without drawing: Enter on the handle, or a tap. It starts
 * on "blocking", what drawing a line from that bar would make.
 */
export default function GanttLinkPicker({
  taskId,
  projectId,
  workspaceId,
  onClose,
}: GanttLinkPickerProps): JSX.Element {
  const { data: relations = [] } = useGetTaskRelations(taskId);

  return (
    <TaskRelationPicker
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      taskId={taskId}
      projectId={projectId}
      workspaceId={workspaceId}
      relations={relations as RelationLike[]}
      initialRelationKey="blocking"
    />
  );
}
