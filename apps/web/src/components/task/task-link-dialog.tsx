import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TaskLink } from "@/fetchers/task-link/get-task-links";
import useCreateTaskLink from "@/hooks/mutations/task-link/use-create-task-link";
import useUpdateTaskLink from "@/hooks/mutations/task-link/use-update-task-link";
import { HttpError } from "@/lib/http-error";
import {
  LINK_ERROR_KEYS,
  MAX_LINK_TITLE_LENGTH,
  normalizeLinkTitle,
  normalizeLinkUrl,
} from "@/lib/link-url";
import { toast } from "@/lib/toast";

type TaskLinkDialogProps = {
  taskId: string;
  /** Edits this link; adds a new one when absent. */
  link?: TaskLink | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Adds or edits one of the task's web links, validating as the API does. */
export default function TaskLinkDialog({
  taskId,
  link,
  open,
  onOpenChange,
}: TaskLinkDialogProps) {
  const { t } = useTranslation();
  const createLink = useCreateTaskLink();
  const updateLink = useUpdateTaskLink();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const isPending = createLink.isPending || updateLink.isPending;

  useEffect(() => {
    if (!open) return;
    setUrl(link?.url ?? "");
    setTitle(link?.title ?? "");
    setUrlError(null);
    setTitleError(null);
  }, [open, link]);

  const validateUrl = () => {
    const result = normalizeLinkUrl(url);
    setUrlError(result.ok ? null : t(LINK_ERROR_KEYS[result.error]));
    return result;
  };

  const validateTitle = () => {
    const result = normalizeLinkTitle(title);
    setTitleError(result.ok ? null : t(LINK_ERROR_KEYS[result.error]));
    return result;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedUrl = validateUrl();
    const normalizedTitle = validateTitle();
    if (!normalizedUrl.ok || !normalizedTitle.ok) return;

    try {
      if (link) {
        const changes: { url?: string; title?: string | null } = {};
        if (normalizedUrl.url !== link.url) changes.url = normalizedUrl.url;
        if (normalizedTitle.title !== link.title) {
          changes.title = normalizedTitle.title;
        }
        if (Object.keys(changes).length > 0) {
          await updateLink.mutateAsync({ taskId, linkId: link.id, changes });
          toast.success(t("tasks:links.toast.updated"));
        }
      } else {
        await createLink.mutateAsync({
          taskId,
          url: normalizedUrl.url,
          title: normalizedTitle.title,
        });
        toast.success(t("tasks:links.toast.added"));
      }
      onOpenChange(false);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        setUrlError(t("tasks:links.errors.duplicate"));
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("tasks:links.toast.error"),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !isPending && onOpenChange(next)}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {link ? t("tasks:links.editTitle") : t("tasks:links.addTitle")}
            </DialogTitle>
          </DialogHeader>
          <fieldset disabled={isPending} className="space-y-4 p-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor="task-link-url">{t("tasks:links.url")}</Label>
              <Input
                id="task-link-url"
                autoFocus
                inputMode="url"
                autoComplete="off"
                value={url}
                placeholder={t("tasks:links.urlPlaceholder")}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? "task-link-url-error" : undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError(null);
                }}
                onBlur={() => {
                  if (url.trim()) validateUrl();
                }}
              />
              {urlError && (
                <p
                  id="task-link-url-error"
                  className="text-destructive-foreground text-xs"
                >
                  {urlError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-link-title">
                {t("tasks:links.linkTitle")}
              </Label>
              <Input
                id="task-link-title"
                maxLength={MAX_LINK_TITLE_LENGTH * 2}
                value={title}
                placeholder={t("tasks:links.titlePlaceholder")}
                aria-invalid={titleError ? true : undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleError(null);
                }}
                onBlur={() => validateTitle()}
              />
              {titleError && (
                <p className="text-destructive-foreground text-xs">
                  {titleError}
                </p>
              )}
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("tasks:links.cancel")}
            </Button>
            <Button type="submit" loading={isPending}>
              {t("tasks:links.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
