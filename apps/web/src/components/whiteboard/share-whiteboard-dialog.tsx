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
import { Switch } from "@/components/ui/switch";
import { useSetWhiteboardPublished } from "@/hooks/mutations/whiteboard/use-whiteboard-mutations";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateLink } from "@/lib/generate-link";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import { publicWhiteboardPath } from "@/lib/whiteboards/whiteboard-paths";
import type { WhiteboardSummary } from "@/types/whiteboard";

type ShareWhiteboardDialogProps = {
  board: Pick<
    WhiteboardSummary,
    "id" | "projectId" | "publicToken" | "archivedAt"
  >;
  canPublish: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function CopyField({
  id,
  label,
  value,
  withOpen,
}: {
  id: string;
  label: string;
  value: string;
  withOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = async () => {
    if (!(await copyToClipboard(value))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={
            copied
              ? t("whiteboards:share.copied")
              : t("whiteboards:share.copyLink")
          }
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="size-3.5 text-success-foreground" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
        {withOpen && (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("whiteboards:share.openLink")}
            render={<a href={value} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Publishing a board to a read-only public link, behind an explicit switch.
 * Turning it off revokes the link at once; each publish issues a new one.
 */
export default function ShareWhiteboardDialog({
  board,
  canPublish,
  open,
  onOpenChange,
}: ShareWhiteboardDialogProps) {
  const { t } = useTranslation();
  const setPublished = useSetWhiteboardPublished();
  const busy = setPublished.isPending;
  const published = Boolean(board.publicToken);
  const publicLink = board.publicToken
    ? generateLink(publicWhiteboardPath(board.publicToken))
    : "";

  const toggle = (next: boolean) => {
    setPublished.mutate(
      { whiteboardId: board.id, projectId: board.projectId, published: next },
      {
        onSuccess: () =>
          toast.success(
            next
              ? t("whiteboards:share.publishedToast")
              : t("whiteboards:share.unpublishedToast"),
          ),
        onError: (error) =>
          toast.error(pageErrorMessage(error) ?? t("whiteboards:share.error")),
      },
    );
  };

  const hint = board.archivedAt
    ? t("whiteboards:share.archivedHint")
    : !canPublish
      ? t("whiteboards:share.cannotPublish")
      : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("whiteboards:share.title")}</DialogTitle>
          <DialogDescription>
            {t("whiteboards:share.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 px-6 pb-2">
          <div className="flex items-start justify-between gap-4">
            <Label
              htmlFor="whiteboard-publish-switch"
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium text-sm">
                {t("whiteboards:share.switchLabel")}
              </span>
              <span className="font-normal text-muted-foreground text-xs">
                {published
                  ? t("whiteboards:share.onHint")
                  : t("whiteboards:share.offHint")}
              </span>
            </Label>
            <Switch
              id="whiteboard-publish-switch"
              checked={published}
              disabled={!canPublish || busy}
              onCheckedChange={toggle}
            />
          </div>
          {hint && (
            <p className="text-muted-foreground text-sm" role="note">
              {hint}
            </p>
          )}
          {published && publicLink && (
            <div className="space-y-1.5">
              <CopyField
                id="whiteboard-public-link"
                label={t("whiteboards:share.linkLabel")}
                value={publicLink}
                withOpen
              />
              <p className="text-muted-foreground text-xs">
                {t("whiteboards:share.privacyNote")}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t("whiteboards:share.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
