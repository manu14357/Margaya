import { Check, Sparkles } from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CaptureThumbnails from "@/components/ai/capture/capture-thumbnails";
import { useAiLocale } from "@/components/editor/ai/use-editor-ai";
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
import { getPriorityLabel } from "@/lib/i18n/domain";
import { INTAKE_PRIORITIES } from "@/lib/intake-search";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
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
 * wait beside the form (the task doesn't exist yet) and are attached once
 * the request is filed; with AI on, they can draft the request first. In
 * edit mode it saves through the intake route, the requester's way to
 * change an open request.
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
  // Pasted images become attachments, which need task:update.
  const canPasteImages = !isEdit && canUpdateTasks();
  const [images, setImages] = useState<CaptureImage[]>([]);
  const imagesRef = useRef<CaptureImage[]>([]);
  imagesRef.current = images;
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

  /** Attaches pasted images to the new request's task, one at a time. */
  const attachImages = async (taskId: string, files: File[]) => {
    let failed = 0;
    for (const file of files) {
      try {
        await uploadTaskAttachment({ taskId, file });
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) toast.warning(t("intake:create.attachFailed"));
  };

  const reset = () => {
    setTitle(intakeItem?.task.title ?? "");
    setDescription(intakeItem ? initialDescription : "");
    setPriority(
      (intakeItem?.task.priority as IntakePriority | undefined) ??
        "no-priority",
    );
    setEditorVersion((version) => version + 1);
    clearImages();
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
          images.length > 0,
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
    const pasted = images.map((image) => image.file);
    create.mutate(
      { projectId, title: trimmed, description, priority },
      {
        onSuccess: (item) => {
          if (pasted.length > 0) void attachImages(item.taskId, pasted);
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
            {canPasteImages && images.length === 0 && (
              <p className="text-muted-foreground text-xs">
                {t("intake:create.pasteHint")}
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
            </div>
          </div>
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
