import { FileTypeIcon } from "@margaya/file-preview";
import { Check, Paperclip, Sparkles, X } from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CaptureThumbnails from "@/components/ai/capture/capture-thumbnails";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
import TaskAttachmentDropZone from "@/components/task/task-attachment-drop-zone";
import TaskDescriptionEditor from "@/components/task/task-description-editor";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAnalyzeCapture } from "@/hooks/mutations/ai/use-ai-capture";
import { useCreateIntakeItem } from "@/hooks/mutations/intake/use-create-intake-item";
import { useUpdateIntakeItem } from "@/hooks/mutations/intake/use-update-intake-item";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { captureDescription } from "@/lib/ai/capture-description";
import {
  type CaptureImage,
  CaptureMediaError,
  imageFilesOf,
  MAX_CAPTURE_IMAGES,
  prepareCaptureImage,
  releaseCaptureImages,
} from "@/lib/ai/capture-media";
import { aiErrorKey } from "@/lib/ai/format";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format-bytes";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { INTAKE_PRIORITIES } from "@/lib/intake-search";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import {
  MAX_FILES_PER_UPLOAD,
  selectUploadFiles,
  uploadFilesWithProgress,
} from "@/lib/upload-files";
import { uploadTaskAttachment } from "@/lib/upload-task-attachment";
import type { IntakeItem, IntakePriority } from "@/types/intake";

type CreateIntakeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Edit mode: the requester's own open request. */
  intakeItem?: IntakeItem;
  /** The request's current description, for edit mode. */
  description?: string;
  /** "View" in the success toast selects the new request. */
  onView?: (item: IntakeItem) => void;
};

/**
 * "New request": a title, a description and a priority. Pasted screenshots
 * and picked or dropped files wait beside the form (the task doesn't exist
 * yet) and are attached once the request is filed; with AI on, screenshots
 * can draft the request first. In edit mode it saves through the intake
 * route, the requester's way to change an open request, and files go into
 * the description as they do on the task itself.
 */
export default function CreateIntakeDialog({
  open,
  onOpenChange,
  projectId,
  intakeItem,
  description: initialDescription = "",
  onView,
}: CreateIntakeDialogProps) {
  const { t } = useTranslation();
  const switchId = useId();
  const isEdit = Boolean(intakeItem);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<IntakePriority>("no-priority");
  const [createMore, setCreateMore] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const create = useCreateIntakeItem();
  const update = useUpdateIntakeItem();
  const draft = useAnalyzeCapture();
  const locale = useAiLocale();
  const { canUpdateTasks } = useWorkspacePermission();
  const { available: aiAvailable } = useAiAvailability(projectId);
  const canUpdate = canUpdateTasks();
  // An edit is the requester's own open request, which the API lets them
  // upload into; a new request's files become attachments (task:update).
  const canAttach = isEdit || canUpdate;
  const canPasteImages = !isEdit && canUpdate;
  const filesLater = t("intake:create.filesAfterSubmit");
  const [images, setImages] = useState<CaptureImage[]>([]);
  const imagesRef = useRef<CaptureImage[]>([]);
  imagesRef.current = images;
  // A new request's picked and dropped files, attached once it is filed.
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const queuedFilesRef = useRef<File[]>([]);
  queuedFilesRef.current = queuedFiles;
  const fileInputRef = useRef<HTMLInputElement>(null);
  // An edit's description editor uploads the files it is handed.
  const editorUploadRef = useRef<((files: File[]) => void) | null>(null);
  const isPending = create.isPending || update.isPending;

  useEffect(() => () => releaseCaptureImages(imagesRef.current), []);

  const clearImages = () => {
    releaseCaptureImages(imagesRef.current);
    setImages([]);
  };

  const handlePaste = (event: ClipboardEvent) => {
    if (!canPasteImages) return;
    const files = imageFilesOf(event.clipboardData);
    if (files.length === 0) return;
    // Taken before the description editor sees it: there's no task to
    // upload an inline image to yet.
    event.preventDefault();
    event.stopPropagation();
    const room = MAX_CAPTURE_IMAGES - imagesRef.current.length;
    if (files.length > room) {
      toast.warning(t("ai:capture.tooMany", { count: MAX_CAPTURE_IMAGES }));
    }
    void (async () => {
      const added: CaptureImage[] = [];
      for (const [index, file] of files.slice(0, Math.max(0, room)).entries()) {
        try {
          added.push(await prepareCaptureImage(file, index));
        } catch (error) {
          toast.error(
            t(
              error instanceof CaptureMediaError && error.code === "tooLarge"
                ? "ai:capture.mediaErrors.tooLarge"
                : "ai:capture.mediaErrors.unreadable",
            ),
          );
        }
      }
      setImages((current) => [...current, ...added]);
    })();
  };

  const queueFiles = useCallback(
    (files: File[]) => {
      const room =
        MAX_FILES_PER_UPLOAD -
        queuedFilesRef.current.length -
        imagesRef.current.length;
      const selected = selectUploadFiles(files, t);
      if (selected.length > room) {
        toast.warning(
          t("tasks:attachments.toast.tooMany", { count: MAX_FILES_PER_UPLOAD }),
        );
      }
      const added = selected.slice(0, Math.max(0, room));
      if (added.length === 0) return;
      queuedFilesRef.current = [...queuedFilesRef.current, ...added];
      setQueuedFiles(queuedFilesRef.current);
    },
    [t],
  );

  const handleEditorUpload = useCallback(
    (upload: ((files: File[]) => void) | null) => {
      editorUploadRef.current = upload;
    },
    [],
  );

  /** Files picked with the button or dropped anywhere on the dialog. */
  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!canAttach) {
      toast.info(filesLater);
      return;
    }
    if (isEdit) editorUploadRef.current?.(files);
    else queueFiles(files);
  };

  const removeQueuedFile = (file: File) =>
    setQueuedFiles((current) => current.filter((queued) => queued !== file));

  const removeImage = (id: string) =>
    setImages((current) => {
      releaseCaptureImages(current.filter((image) => image.id === id));
      return current.filter((image) => image.id !== id);
    });

  const draftFromImages = () => {
    if (images.length === 0 || draft.isPending) return;
    const notes = [title.trim(), description.trim()]
      .filter(Boolean)
      .join("\n\n");
    draft.mutate(
      {
        projectId,
        body: {
          source: "screenshot",
          images: images.map((image) => ({
            mediaType: image.mediaType,
            data: image.data,
          })),
          ...(notes ? { text: notes } : {}),
          ...(locale ? { locale } : {}),
        },
      },
      {
        onSuccess: (result) => {
          const [item] = result.items;
          if (!item) {
            toast.info(t("ai:capture.empty"));
            return;
          }
          setTitle(item.title);
          setDescription(captureDescription(item, t));
          setPriority(item.priority);
          setEditorVersion((version) => version + 1);
        },
        onError: (error) => toast.error(t(aiErrorKey(error))),
      },
    );
  };

  /** Attaches the waiting files to the new request's task, one at a time. */
  const attachFiles = (taskId: string, files: File[]) =>
    uploadFilesWithProgress({
      files,
      t,
      upload: (file, signal) => uploadTaskAttachment({ taskId, file, signal }),
    });

  const reset = () => {
    setTitle(intakeItem?.task.title ?? "");
    setDescription(intakeItem ? initialDescription : "");
    setPriority(
      (intakeItem?.task.priority as IntakePriority | undefined) ??
        "no-priority",
    );
    setEditorVersion((version) => version + 1);
    clearImages();
    setQueuedFiles([]);
    draft.reset();
  };

  // Each opening starts fresh (or from the request being edited).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
  useEffect(() => {
    if (open) reset();
  }, [open]);

  const isDirty = isEdit
    ? title !== (intakeItem?.task.title ?? "") ||
      description !== initialDescription ||
      priority !== intakeItem?.task.priority
    : Boolean(
        title.trim() ||
          description.trim() ||
          priority !== "no-priority" ||
          images.length > 0 ||
          queuedFiles.length > 0,
      );

  const requestClose = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (isDirty && !isPending) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed || isPending) return;
    if (intakeItem) {
      update.mutate(
        { id: intakeItem.id, title: trimmed, description, priority },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast.success(t("intake:create.saved"));
          },
          onError: (error) =>
            toast.error(error.message || t("intake:create.saveError")),
        },
      );
      return;
    }
    const waiting = [...images.map((image) => image.file), ...queuedFiles];
    create.mutate(
      { projectId, title: trimmed, description, priority },
      {
        onSuccess: (item) => {
          if (waiting.length > 0) void attachFiles(item.taskId, waiting);
          toast.success(t("intake:create.toast"), {
            action: onView
              ? {
                  label: t("intake:create.toastView"),
                  onClick: () => onView(item),
                }
              : undefined,
          });
          if (createMore) {
            setTitle("");
            setDescription("");
            setPriority("no-priority");
            setEditorVersion((version) => version + 1);
            // The files are uploading; only the previews go.
            for (const image of images) URL.revokeObjectURL(image.url);
            setImages([]);
            setQueuedFiles([]);
          } else {
            onOpenChange(false);
          }
        },
        onError: (error) =>
          toast.error(error.message || t("intake:create.error")),
      },
    );
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden"
        onPasteCapture={handlePaste}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEdit ? t("intake:create.editTitle") : t("intake:create.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("intake:create.titlePlaceholder")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            data-testid="intake-file-input"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Picking the same file again must fire change again.
              event.target.value = "";
              addFiles(files);
            }}
          />
          <TaskAttachmentDropZone
            onFiles={addFiles}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
              <Input
                unstyled
                value={title}
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
                aria-label={t("intake:create.titlePlaceholder")}
                placeholder={t("intake:create.titlePlaceholder")}
                className="w-full [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:px-0 [&_[data-slot=input]]:py-3 [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:text-2xl [&_[data-slot=input]]:text-foreground [&_[data-slot=input]]:leading-tight [&_[data-slot=input]]:tracking-tight [&_[data-slot=input]]:outline-none [&_[data-slot=input]]:placeholder:text-muted-foreground"
              />
              <div className="min-h-[160px]">
                <TaskDescriptionEditor
                  key={editorVersion}
                  value={description}
                  onChange={setDescription}
                  placeholder={t("intake:create.descriptionPlaceholder")}
                  taskId={intakeItem?.taskId}
                  allowFileUploads={canAttach}
                  fileUploadsDisabledMessage={filesLater}
                  onQueueFiles={isEdit ? undefined : queueFiles}
                  onUploadFilesChange={isEdit ? handleEditorUpload : undefined}
                />
              </div>
              {canPasteImages && images.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-xs">
                      {t("intake:create.pastedImages")}
                    </span>
                    {aiAvailable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={draft.isPending || isPending}
                        onClick={draftFromImages}
                      >
                        {draft.isPending ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <Sparkles className="text-muted-foreground" />
                        )}
                        {draft.isPending
                          ? t("ai:capture.drafting")
                          : t("ai:capture.draftFromImages")}
                      </Button>
                    )}
                  </div>
                  <CaptureThumbnails
                    images={images}
                    onRemove={removeImage}
                    removeLabel={(name) =>
                      t("intake:create.removeImage", { name })
                    }
                  />
                </div>
              )}
              {!isEdit && queuedFiles.length > 0 && (
                <div className="space-y-2">
                  <span className="font-medium text-xs">
                    {t("intake:create.queuedFiles")}
                  </span>
                  <ul className="flex flex-col gap-1">
                    {queuedFiles.map((file, index) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: two picks may queue files with the same name
                        key={`${file.name}-${index}`}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
                      >
                        <FileTypeIcon
                          name={file.name}
                          mimeType={file.type}
                          size={20}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBytes(file.size)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("intake:create.removeImage", {
                            name: file.name,
                          })}
                          onClick={() => removeQueuedFile(file)}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {canPasteImages &&
                images.length === 0 &&
                queuedFiles.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t("intake:create.fileHint")}
                  </p>
                )}
              <div className="flex items-center gap-2 pb-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("intake:create.priority")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-xs transition-colors hover:bg-accent/50",
                        priority !== "no-priority"
                          ? "bg-accent/30 text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {getPriorityIcon(priority)}
                      {priority === "no-priority"
                        ? t("intake:create.priority")
                        : getPriorityLabel(priority)}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="start">
                    {INTAKE_PRIORITIES.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/50"
                        onClick={() => setPriority(option)}
                      >
                        {getPriorityIcon(option)}
                        {getPriorityLabel(option)}
                        {priority === option && (
                          <Check className="ml-auto size-4" />
                        )}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                {canAttach && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-accent/50"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="size-3.5" />
                    {t("intake:create.attachFiles")}
                  </button>
                )}
              </div>
            </div>
          </TaskAttachmentDropZone>
          <DialogFooter className="items-center">
            {!isEdit && (
              <div className="mr-auto flex items-center gap-2">
                <Switch
                  id={switchId}
                  checked={createMore}
                  onCheckedChange={(checked) => setCreateMore(checked)}
                />
                <Label htmlFor={switchId} className="text-xs">
                  {t("intake:create.createMore")}
                </Label>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => requestClose(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!title.trim() || isPending}
            >
              {isEdit ? t("intake:create.save") : t("intake:create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("intake:create.discardTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("intake:create.discardDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button type="button" variant="outline" size="sm" />}
            >
              {t("intake:create.keepEditing")}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              {t("intake:create.discard")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
