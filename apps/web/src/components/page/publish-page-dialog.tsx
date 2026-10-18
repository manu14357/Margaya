import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  usePublishPage,
  useUnpublishPage,
} from "@/hooks/mutations/page/use-page-publication-mutations";
import { usePagePublication } from "@/hooks/queries/page/use-page-publication";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateLink } from "@/lib/generate-link";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";

type PublishPageDialogProps = {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Publishing a page to a read-only public link, behind an explicit switch.
 * Turning it off revokes the link at once.
 */
export default function PublishPageDialog({
  pageId,
  open,
  onOpenChange,
}: PublishPageDialogProps) {
  const { t } = useTranslation();
  const publication = usePagePublication(pageId, open);
  const publish = usePublishPage();
  const unpublish = useUnpublishPage();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = publish.isPending || unpublish.isPending;

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const state = publication.data;
  const link = state?.path ? generateLink(state.path) : "";
  const canToggle = state
    ? state.published
      ? state.canUnpublish
      : state.canPublish
    : false;

  const toggle = (next: boolean) => {
    const options = {
      onError: (error: unknown) =>
        toast.error(pageErrorMessage(error) ?? t("pages:publish.error")),
    };
    if (next) {
      publish.mutate(pageId, {
        ...options,
        onSuccess: () => toast.success(t("pages:publish.publishedToast")),
      });
    } else {
      unpublish.mutate(pageId, {
        ...options,
        onSuccess: () => toast.success(t("pages:publish.unpublishedToast")),
      });
    }
  };

  const copy = async () => {
    if (!link || !(await copyToClipboard(link))) return;
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1200);
  };

  const hint = !state
    ? null
    : !state.allowed
      ? t("pages:publish.disabledByWorkspace")
      : !state.published && !state.canPublish
        ? t("pages:publish.cannotPublish")
        : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("pages:publish.title")}</DialogTitle>
          <DialogDescription>
            {t("pages:publish.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          {publication.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : publication.isError || !state ? (
            <p className="text-muted-foreground text-sm">
              {t("pages:publish.loadError")}
            </p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <Label
                  htmlFor="page-publish-switch"
                  className="flex flex-col items-start gap-0.5"
                >
                  <span className="font-medium text-sm">
                    {t("pages:publish.switchLabel")}
                  </span>
                  <span className="font-normal text-muted-foreground text-xs">
                    {state.published
                      ? t("pages:publish.onHint")
                      : t("pages:publish.offHint")}
                  </span>
                </Label>
                <Switch
                  id="page-publish-switch"
                  checked={state.published}
                  disabled={!canToggle || busy}
                  onCheckedChange={toggle}
                />
              </div>
              {hint && (
                <p className="text-muted-foreground text-sm" role="note">
                  {hint}
                </p>
              )}
              {state.published && link && (
                <div className="space-y-1.5">
                  <Label htmlFor="page-publish-link">
                    {t("pages:publish.linkLabel")}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="page-publish-link"
                      readOnly
                      value={link}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={
                        copied
                          ? t("pages:publish.copied")
                          : t("pages:publish.copyLink")
                      }
                      onClick={() => void copy()}
                    >
                      {copied ? (
                        <Check className="size-3.5 text-success-foreground" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={t("pages:publish.openLink")}
                      render={
                        // biome-ignore lint/a11y/useAnchorContent: the button renders the icon
                        <a href={link} target="_blank" rel="noreferrer" />
                      }
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("pages:publish.privacyNote")}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("pages:publish.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
