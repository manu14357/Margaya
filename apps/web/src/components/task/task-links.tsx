import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { type ReactNode, type Ref, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TaskLink } from "@/fetchers/task-link/get-task-links";
import useDeleteTaskLink from "@/hooks/mutations/task-link/use-delete-task-link";
import useGetTaskLinks from "@/hooks/queries/task-link/use-get-task-links";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import TaskLinkDialog from "./task-link-dialog";
import TaskLinkRow from "./task-link-row";

export type TaskLinksHandle = { openAdd: () => void };

type TaskLinksProps = {
  taskId: string;
  ref?: Ref<TaskLinksHandle>;
};

/**
 * The task's web links. The section shows once there is a link; the action
 * bar's "Add link" opens the same dialog through `ref`.
 */
export default function TaskLinks({ taskId, ref }: TaskLinksProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);
  const [editing, setEditing] = useState<TaskLink | "new" | null>(null);
  const [removing, setRemoving] = useState<TaskLink | null>(null);
  const {
    data: links = [],
    isLoading,
    isError,
    refetch,
  } = useGetTaskLinks(taskId);
  const deleteLink = useDeleteTaskLink();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  useImperativeHandle(ref, () => ({ openAdd: () => setEditing("new") }), []);

  const handleRemove = () => {
    if (!removing) return;
    const link = removing;
    setRemoving(null);
    deleteLink.mutate(
      { taskId, linkId: link.id },
      {
        onSuccess: () => toast.success(t("tasks:links.toast.removed")),
        onError: (error) =>
          toast.error(error.message || t("tasks:links.toast.error")),
      },
    );
  };

  const dialogs = (
    <>
      {canEdit && (
        <TaskLinkDialog
          taskId={taskId}
          link={editing === "new" ? null : editing}
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks:links.removeConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:links.removeConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t("tasks:links.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleRemove}>
              {t("tasks:links.remove")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  // Hidden while loading and when empty; the dialogs stay mounted in place.
  let section: ReactNode = null;
  if (isError) {
    section = (
      <div className="flex items-center gap-2 px-2 text-muted-foreground text-xs">
        <span>{t("tasks:links.loadError")}</span>
        <Button variant="ghost" size="xs" onClick={() => void refetch()}>
          {t("tasks:links.retry")}
        </Button>
      </div>
    );
  } else if (!isLoading && links.length > 0) {
    section = (
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <span>{t("tasks:links.title")}</span>
              </button>
            </CollapsibleTrigger>
            <span className="text-muted-foreground text-xs">
              {links.length}
            </span>
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              aria-label={t("tasks:links.add")}
              title={t("tasks:links.add")}
              onClick={() => setEditing("new")}
            >
              <Plus className="size-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent>
          <TooltipProvider>
            <div className="mt-1 flex flex-col">
              {links.map((link) => (
                <TaskLinkRow
                  key={link.id}
                  link={link}
                  canEdit={canEdit}
                  onEdit={() => setEditing(link)}
                  onRemove={() => setRemoving(link)}
                />
              ))}
            </div>
          </TooltipProvider>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <>
      {section}
      {dialogs}
    </>
  );
}
