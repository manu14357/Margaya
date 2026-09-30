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
import {
  useCreateModuleLink,
  useUpdateModuleLink,
} from "@/hooks/mutations/module/use-module-link-mutations";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import type { ModuleLink } from "@/types/module";

type ModuleLinkDialogProps = {
  module: { id: string; projectId: string };
  /** Edits this link; adds a new one when absent. */
  link?: ModuleLink | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Whether the text reads as an http(s) URL once https:// is assumed. */
export function isLinkUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname.includes(".") || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/** Adds or edits one of a module's reference links. */
export default function ModuleLinkDialog({
  module,
  link,
  open,
  onOpenChange,
}: ModuleLinkDialogProps) {
  const { t } = useTranslation();
  const createLink = useCreateModuleLink();
  const updateLink = useUpdateModuleLink();
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
    if (!url.trim()) {
      setUrlError(t("modules:links.urlRequired"));
      return;
    }
    if (!isLinkUrl(url)) {
      setUrlError(t("modules:links.urlInvalid"));
      return;
    }
    const json = { url: url.trim(), title: title.trim() || null };
    try {
      if (link) {
        await updateLink.mutateAsync({
          moduleId: module.id,
          linkId: link.id,
          projectId: module.projectId,
          json,
        });
      } else {
        await createLink.mutateAsync({
          moduleId: module.id,
          projectId: module.projectId,
          json,
        });
      }
      toast.success(t("modules:toast.linkSaved"));
      onOpenChange(false);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        setUrlError(t("modules:links.duplicate"));
        return;
      }
      if (error instanceof HttpError && error.status === 400) {
        setUrlError(error.message || t("modules:links.urlInvalid"));
        return;
      }
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("modules:toast.linkError"),
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
              {link
                ? t("modules:links.editTitle")
                : t("modules:links.addTitle")}
            </DialogTitle>
          </DialogHeader>
          <fieldset disabled={isPending} className="space-y-4 p-6 pt-1">
            <div className="space-y-2">
              <Label htmlFor="module-link-url">{t("modules:links.url")}</Label>
              <Input
                id="module-link-url"
                autoFocus
                type="url"
                maxLength={2048}
                value={url}
                placeholder={t("modules:links.urlPlaceholder")}
                aria-invalid={urlError ? true : undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError(null);
                }}
              />
              {urlError && (
                <p className="text-destructive text-sm">{urlError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="module-link-title">
                {t("modules:links.title")}
              </Label>
              <Input
                id="module-link-title"
                maxLength={255}
                value={title}
                placeholder={t("modules:links.titlePlaceholder")}
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
              {t("modules:links.cancel")}
            </Button>
            <Button type="submit" loading={isPending}>
              {t("modules:links.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
