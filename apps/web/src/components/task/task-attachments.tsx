import { ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import {
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
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
import type { TaskAttachment } from "@/fetchers/task-attachment/get-task-attachments";
import useDeleteTaskAttachment from "@/hooks/mutations/task-attachment/use-delete-task-attachment";
import useUploadTaskAttachments from "@/hooks/mutations/task-attachment/use-upload-task-attachments";
import useGetTaskAttachments from "@/hooks/queries/task-attachment/use-get-task-attachments";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import TaskAttachmentDropZone from "./task-attachment-drop-zone";
import TaskAttachmentRow, { PendingAttachmentRow } from "./task-attachment-row";

export type TaskAttachmentsHandle = {
  /** Opens the file picker (and reveals the section). */
  openPicker: () => void;
  /** Uploads files dropped elsewhere, like on the action bar. */
  addFiles: (files: File[]) => void;
};

type TaskAttachmentsProps = {
  taskId: string;
  ref?: Ref<TaskAttachmentsHandle>;
};

/**
 * Files attached to the task. The section shows once there is a file, an
 * upload runs or the user asked to attach one; editors can drop files on it.
 */
export default function TaskAttachments({ taskId, ref }: TaskAttachmentsProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [deleting, setDeleting] = useState<TaskAttachment | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    data: attachments = [],
    isLoading,
    isError,
    refetch,
  } = useGetTaskAttachments(taskId);
  const { pending, upload } = useUploadTaskAttachments(taskId);
  const deleteAttachment = useDeleteTaskAttachment();
  const { canUpdateTasks, canDeleteTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const openPicker = () => {
    if (!canEdit) return;
    setRevealed(true);
    setIsOpen(true);
    inputRef.current?.click();
  };

  const addFiles = (files: File[]) => {
    if (!canEdit || files.length === 0) return;
    setRevealed(true);
    setIsOpen(true);
    upload(files);
  };

  useImperativeHandle(ref, () => ({ openPicker, addFiles }));

  // The uploader may delete with task:update; anyone else needs task:delete.
  const canDelete = (attachment: TaskAttachment) =>
    (canEdit && Boolean(user?.id) && attachment.createdBy?.id === user?.id) ||
    canDeleteTasks();

  const handleDelete = () => {
    if (!deleting) return;
    const attachment = deleting;
    setDeleting(null);
    deleteAttachment.mutate(
      { taskId, attachmentId: attachment.id },
      {
        onSuccess: () => toast.success(t("tasks:attachments.toast.deleted")),
        onError: (error) =>
          toast.error(
            error.message || t("tasks:attachments.toast.deleteError"),
          ),
      },
    );
  };

  const fileInput = canEdit ? (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      data-testid="task-attachment-input"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        // Picking the same file again must fire change again.
        event.target.value = "";
        addFiles(files);
      }}
    />
  ) : null;

  const hasRows = attachments.length > 0 || pending.length > 0;
  const visible =
    hasRows || (!isLoading && !isError && revealed && canEdit) || isError;

  let section: ReactNode = null;
  if (visible) {
    const count = attachments.length + pending.length;
    section = (
      <TaskAttachmentDropZone disabled={!canEdit} onFiles={addFiles}>
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
                  <span>{t("tasks:attachments.title")}</span>
                </button>
              </CollapsibleTrigger>
              {count > 0 && (
                <span className="text-muted-foreground text-xs">{count}</span>
              )}
            </div>
            {canEdit && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                aria-label={t("tasks:attachments.add")}
                title={t("tasks:attachments.add")}
                onClick={openPicker}
              >
                <Paperclip className="size-3.5" />
              </Button>
            )}
          </div>

          <CollapsibleContent>
            {isError ? (
              <div className="flex items-center gap-2 px-2 py-1 text-muted-foreground text-xs">
                <span>{t("tasks:attachments.loadError")}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void refetch()}
                >
                  {t("tasks:links.retry")}
                </Button>
              </div>
            ) : null}
            {hasRows ? (
              <TooltipProvider>
                <div className="mt-1 flex flex-col">
                  {pending.map((item) => (
                    <PendingAttachmentRow
                      key={item.id}
                      filename={item.filename}
                    />
                  ))}
                  {attachments.map((attachment) => (
                    <TaskAttachmentRow
                      key={attachment.id}
                      attachment={attachment}
                      canDelete={canDelete(attachment)}
                      onDelete={() => setDeleting(attachment)}
                    />
                  ))}
                </div>
              </TooltipProvider>
            ) : (
              canEdit &&
              !isError && (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-md border border-border border-dashed px-3 py-4 text-muted-foreground text-xs transition-colors hover:border-primary/50 hover:text-foreground"
                  onClick={openPicker}
                >
                  <Paperclip className="size-3.5" />
                  {t("tasks:attachments.dropHere")}
                </button>
              )
            )}
          </CollapsibleContent>
        </Collapsible>
      </TaskAttachmentDropZone>
    );
  }

  return (
    <>
      {section}
      {fileInput}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks:attachments.deleteConfirmTitle", {
                filename: deleting?.filename ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:attachments.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t("common:actions.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t("tasks:attachments.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
