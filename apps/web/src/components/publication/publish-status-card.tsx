import { Globe, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Separator } from "@/components/ui/separator";
import { usePublicationActions } from "@/hooks/mutations/publication/use-publication-mutations";
import { formatDateMedium } from "@/lib/format";
import { publicBoardUrl } from "@/lib/publication/settings";
import { toast } from "@/lib/toast";
import type { ProjectPublication } from "@/types/publication";
import PublishLinkField from "./publish-link-field";

type PublishStatusCardProps = {
  projectId: string;
  publication: ProjectPublication;
};

type Confirm = "rotate" | "unpublish" | null;

/** Not published or Live, with Publish, the link and Rotate / Unpublish. */
export default function PublishStatusCard({
  projectId,
  publication,
}: PublishStatusCardProps) {
  const { t } = useTranslation();
  const { publish, unpublish, rotate } = usePublicationActions(projectId);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const { canManage, published } = publication;
  const boardsOff = !publication.availability.publicBoards;
  const url = publicBoardUrl(publication.path, window.location.origin);
  const showActions = canManage && Boolean(publication.linkToken);

  const handlePublish = () =>
    publish.mutate(undefined, {
      onSuccess: () =>
        toast.success(t("settings:projectPublish.status.published")),
      onError: (error) =>
        toast.error(
          error.message || t("settings:projectPublish.status.publishError"),
        ),
    });

  const handleConfirm = () => {
    if (confirm === "rotate") {
      rotate.mutate(undefined, {
        onSuccess: () =>
          toast.success(t("settings:projectPublish.rotate.done")),
        onError: (error) =>
          toast.error(
            error.message || t("settings:projectPublish.rotate.error"),
          ),
      });
    } else if (confirm === "unpublish") {
      unpublish.mutate(undefined, {
        onSuccess: () =>
          toast.success(t("settings:projectPublish.unpublish.done")),
        onError: (error) =>
          toast.error(
            error.message || t("settings:projectPublish.unpublish.error"),
          ),
      });
    }
    setConfirm(null);
  };

  return (
    <div className="space-y-4 rounded-md border border-border bg-sidebar p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card">
            <Globe className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 space-y-0.5">
            {published ? (
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-success" />
                </span>
                {t("settings:projectPublish.status.liveTitle")}
              </p>
            ) : (
              <p className="text-sm font-medium">
                {t("settings:projectPublish.status.notPublishedTitle")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {published
                ? t("settings:projectPublish.status.liveHint")
                : t("settings:projectPublish.status.notPublishedHint")}
            </p>
            {published &&
              publication.publishedBy &&
              publication.publishedAt && (
                <p className="text-xs text-muted-foreground">
                  {t("settings:projectPublish.status.publishedBy", {
                    name: publication.publishedBy.name,
                    date: formatDateMedium(publication.publishedAt),
                  })}
                </p>
              )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!published && (
            <Button
              size="sm"
              onClick={handlePublish}
              disabled={!canManage || boardsOff || publish.isPending}
            >
              {publish.isPending
                ? t("settings:projectPublish.status.publishing")
                : t("settings:projectPublish.status.publish")}
            </Button>
          )}
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("settings:projectPublish.status.moreActions")}
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setConfirm("rotate")}>
                  {t("settings:projectPublish.rotate.action")}
                </DropdownMenuItem>
                {published && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirm("unpublish")}
                  >
                    {t("settings:projectPublish.unpublish.action")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {published && (
        <>
          <Separator />
          <PublishLinkField url={url} />
        </>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "rotate"
                ? t("settings:projectPublish.rotate.title")
                : t("settings:projectPublish.unpublish.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "rotate"
                ? t("settings:projectPublish.rotate.description")
                : t("settings:projectPublish.unpublish.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button
              variant={confirm === "unpublish" ? "destructive" : "default"}
              size="sm"
              onClick={handleConfirm}
            >
              {confirm === "rotate"
                ? t("settings:projectPublish.rotate.confirm")
                : t("settings:projectPublish.unpublish.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
