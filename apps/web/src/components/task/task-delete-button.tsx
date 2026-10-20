import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { toastTaskTrashed } from "@/lib/task-undo";
import { toast } from "@/lib/toast";

type TaskDeleteButtonProps = {
  taskId: string;
  onDeleted: () => void;
  className?: string;
  /** Hide the label (tight headers); the name stays on `aria-label`. */
  iconOnly?: boolean;
};

export default function TaskDeleteButton({
  taskId,
  onDeleted,
  className,
  iconOnly = false,
}: TaskDeleteButtonProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { canDeleteTasks, isCheckingPermissions } = useWorkspacePermission();
  const { mutateAsync: deleteTask, isPending } = useDeleteTask();

  if (isCheckingPermissions || !canDeleteTasks()) {
    return null;
  }

  const handleDelete = async () => {
    try {
      const deleted = await deleteTask(taskId);
      toastTaskTrashed(
        { taskId: deleted.id, projectId: deleted.projectId },
        { t },
      );
      setIsOpen(false);
      onDeleted();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size={iconOnly ? "icon-sm" : "sm"}
            aria-label={t("tasks:delete.action")}
            title={iconOnly ? t("tasks:delete.action") : undefined}
            className={cn(
              "text-destructive hover:bg-destructive/10 hover:text-destructive",
              className,
            )}
          />
        }
      >
        <Trash2 className="size-4" />
        {!iconOnly && (
          <span className="hidden sm:inline">{t("tasks:delete.action")}</span>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("tasks:delete.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="outline" size="sm" disabled={isPending} />}
          >
            {t("common:actions.cancel")}
          </AlertDialogClose>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() => void handleDelete()}
          >
            {isPending
              ? t("common:actions.deleting")
              : t("tasks:delete.action")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
