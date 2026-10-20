import { Link as LinkIcon, ListTree, Paperclip, Waypoints } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import TaskAttachmentDropZone from "./task-attachment-drop-zone";

type TaskDetailActionBarProps = {
  onAddSubtask: () => void;
  onAddRelation: () => void;
  onAddLink: () => void;
  onAttachFile: () => void;
  /** Files dropped on "Attach file". */
  onDropFiles: (files: File[]) => void;
  /** More actions after the built-in ones (each hides itself). */
  children?: ReactNode;
};

/** Quick actions under the description; editors only. */
export default function TaskDetailActionBar({
  onAddSubtask,
  onAddRelation,
  onAddLink,
  onAttachFile,
  onDropFiles,
  children,
}: TaskDetailActionBarProps) {
  const { t } = useTranslation();
  const { canUpdateTasks, canCreateTasks } = useWorkspacePermission();

  if (!canUpdateTasks()) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canCreateTasks() && (
        <Button variant="outline" size="xs" onClick={onAddSubtask}>
          <ListTree className="size-3.5" />
          {t("tasks:detailActions.addSubtask")}
        </Button>
      )}
      <Button variant="outline" size="xs" onClick={onAddRelation}>
        <Waypoints className="size-3.5" />
        {t("tasks:detailActions.addRelation")}
      </Button>
      <Button variant="outline" size="xs" onClick={onAddLink}>
        <LinkIcon className="size-3.5" />
        {t("tasks:detailActions.addLink")}
      </Button>
      <TaskAttachmentDropZone onFiles={onDropFiles} showLabel={false}>
        <Button variant="outline" size="xs" onClick={onAttachFile}>
          <Paperclip className="size-3.5" />
          {t("tasks:detailActions.attachFile")}
        </Button>
      </TaskAttachmentDropZone>
      {children}
    </div>
  );
}
