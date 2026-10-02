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
import type { QuickLink } from "@/fetchers/quick-link/get-quick-links";
import {
  useCreateQuickLink,
  useUpdateQuickLink,
} from "@/hooks/mutations/quick-link/use-quick-link-mutations";
import { HttpError } from "@/lib/http-error";
import {
  MAX_LINK_TITLE_LENGTH,
  normalizeLinkTitle,
  normalizeLinkUrl,
} from "@/lib/link-url";
import { toast } from "@/lib/toast";

export const QUICK_LINKS_LIMIT = 50;

type QuickLinkDialogProps = {
  workspaceId: string;
  /** Edits this link; adds a new one when absent. */
  link?: QuickLink | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Adds or edits a quick link, validating the URL as the API does. */
export default function QuickLinkDialog({
  workspaceId,
  link,
  open,
  onOpenChange,
}: QuickLinkDialogProps) {
  const { t } = useTranslation();
  const createLink = useCreateQuickLink();
  const updateLink = useUpdateQuickLink();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const isPending = createLink.isPending || updateLink.isPending;

  useEffect(() => {
    if (!open) return;
    setUrl(link?.url ?? "");
    setTitle(link?.title ?? "");
    setUrlError(null);
  }, [open, link]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedUrl.ok) {
      setUrlError(t("home:quickLinks.dialog.invalidUrl"));
      return;
    }
    const normalizedTitle = normalizeLinkTitle(title);
    const nextTitle = normalizedTitle.ok ? normalizedTitle.title : null;

    try {
      if (link) {
        const changes: { url?: string; title?: string | null } = {};
        if (normalizedUrl.url !== link.url) changes.url = normalizedUrl.url;
        if (nextTitle !== link.title) changes.title = nextTitle;
        if (Object.keys(changes).length > 0) {
          await updateLink.mutateAsync({
            workspaceId,
            quickLinkId: link.id,
            changes,
          });
        }
        toast.success(t("home:quickLinks.toast.updated"));
      } else {
        await createLink.mutateAsync({
          workspaceId,
          url: normalizedUrl.url,
          title: nextTitle,
        });
        toast.success(t("home:quickLinks.toast.added"));
      }
      onOpenChange(false);
    } catch (error) {
      // The API answers 409 for a duplicate URL and 422 for the link cap.
      if (error instanceof HttpError && error.status === 409) {
        setUrlError(t("home:quickLinks.toast.duplicate"));
        return;
      }
      if (error instanceof HttpError && error.status === 422) {
        toast.error(
          t("home:quickLinks.toast.limit", { count: QUICK_LINKS_LIMIT }),
        );
        return;
      }
      if (error instanceof HttpError && error.status === 400) {
        setUrlError(t("home:quickLinks.dialog.invalidUrl"));
        return;
      }
      toast.error(t("home:quickLinks.toast.saveError"));
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
              {link
                ? t("home:quickLinks.dialog.editTitle")
                : t("home:quickLinks.dialog.addTitle")}
            </DialogTitle>
          </DialogHeader>
          <fieldset disabled={isPending} className="space-y-4 p-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor="quick-link-url">
                {t("home:quickLinks.dialog.urlLabel")}
              </Label>
              <Input
                id="quick-link-url"
                autoFocus
                inputMode="url"
                autoComplete="off"
                value={url}
                placeholder={t("home:quickLinks.dialog.urlPlaceholder")}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? "quick-link-url-error" : undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError(null);
                }}
              />
              {urlError && (
                <p
                  id="quick-link-url-error"
                  className="text-destructive-foreground text-xs"
                >
                  {urlError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-link-title">
                {t("home:quickLinks.dialog.titleLabel")}
                <span className="ms-1 font-normal text-muted-foreground">
                  {t("home:quickLinks.dialog.optional")}
                </span>
              </Label>
              <Input
                id="quick-link-title"
                maxLength={MAX_LINK_TITLE_LENGTH}
                value={title}
                placeholder={t("home:quickLinks.dialog.titlePlaceholder")}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
          </fieldset>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? t("home:quickLinks.dialog.saving")
                : link
                  ? t("home:quickLinks.dialog.save")
                  : t("home:quickLinks.dialog.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
