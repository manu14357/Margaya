import { Check } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Switch } from "@/components/ui/switch";
import { useCreateIntakeItem } from "@/hooks/mutations/intake/use-create-intake-item";
import { useUpdateIntakeItem } from "@/hooks/mutations/intake/use-update-intake-item";
import { cn } from "@/lib/cn";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { INTAKE_PRIORITIES } from "@/lib/intake-search";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
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
 * "New request": a title, a description without uploads (there is no task
 * yet) and a priority. In edit mode it saves through the intake route, the
 * requester's way to change an open request.
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
  const isPending = create.isPending || update.isPending;

  const reset = () => {
    setTitle(intakeItem?.task.title ?? "");
    setDescription(intakeItem ? initialDescription : "");
    setPriority(
      (intakeItem?.task.priority as IntakePriority | undefined) ??
        "no-priority",
    );
    setEditorVersion((version) => version + 1);
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
    : Boolean(title.trim() || description.trim() || priority !== "no-priority");

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
    create.mutate(
      { projectId, title: trimmed, description, priority },
      {
        onSuccess: (item) => {
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
