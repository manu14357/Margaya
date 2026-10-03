import { Link } from "@tanstack/react-router";
import { MessageSquare, MoreHorizontal } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicCommentModeration } from "@/hooks/mutations/publication/use-public-comment-moderation";
import { usePublicComments } from "@/hooks/queries/publication/use-publication";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { PublicCommentModerationItem } from "@/types/publication";
import AuthorKindBadge from "./author-kind-badge";
import BlockPersonDialog, { type BlockTarget } from "./block-person-dialog";

type PublicCommentsModerationProps = {
  projectId: string;
  workspaceId: string;
  canManage: boolean;
};

/** Recent public comments, newest first, with moderation row actions. */
export default function PublicCommentsModeration({
  projectId,
  workspaceId,
  canManage,
}: PublicCommentsModerationProps) {
  const { t } = useTranslation();
  const comments = usePublicComments(projectId);
  const { setVisibility, remove } = usePublicCommentModeration(projectId);
  const [deleting, setDeleting] = useState<PublicCommentModerationItem | null>(
    null,
  );
  const [blocking, setBlocking] = useState<BlockTarget | null>(null);
  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];

  const hide = (item: PublicCommentModerationItem) =>
    setVisibility.mutate(
      {
        commentId: item.commentId,
        taskId: item.taskId,
        visibility: "internal",
      },
      {
        onSuccess: () =>
          toast.success(t("settings:projectPublish.moderation.hidden")),
        onError: (error) =>
          toast.error(
            error.message ||
              t("settings:projectPublish.moderation.actionError"),
          ),
      },
    );

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(
      { commentId: deleting.commentId, taskId: deleting.taskId },
      {
        onSuccess: () =>
          toast.success(t("settings:projectPublish.moderation.deleted")),
        onError: (error) =>
          toast.error(
            error.message ||
              t("settings:projectPublish.moderation.actionError"),
          ),
      },
    );
    setDeleting(null);
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">
        {t("settings:projectPublish.moderation.recent")}
      </h3>
      <div className="rounded-md border border-border bg-sidebar">
        {comments.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : comments.isError ? (
          <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <span>{t("settings:projectPublish.loadError")}</span>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void comments.refetch()}
            >
              {t("settings:projectPublish.retry")}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <MessageSquare className="size-4" />
            {t("settings:projectPublish.moderation.recentEmpty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li
                key={item.commentId}
                className="flex items-start gap-3 px-3 py-2.5"
              >
                <Avatar className="mt-0.5 size-6">
                  <AvatarImage src={item.author?.image ?? ""} alt="" />
                  <AvatarFallback className="text-[10px]">
                    {getInitials(item.author?.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {item.taskKey}
                    </span>
                    <span className="font-medium text-sm text-foreground">
                      {item.author?.name ??
                        t("settings:projectPublish.moderation.unknownAuthor")}
                    </span>
                    {item.author && <AuthorKindBadge kind={item.author.kind} />}
                    <time
                      dateTime={item.createdAt}
                      title={formatDateTime(item.createdAt)}
                      className="text-muted-foreground"
                    >
                      {formatRelativeTime(item.createdAt)}
                    </time>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.taskTitle}
                  </p>
                  <p className="line-clamp-2 text-sm text-foreground/90">
                    {item.excerpt}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t(
                          "settings:projectPublish.moderation.actions",
                        )}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={
                        <Link
                          to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                          params={{
                            workspaceId,
                            projectId,
                            taskId: item.taskId,
                          }}
                        />
                      }
                    >
                      {t("settings:projectPublish.moderation.openTask")}
                    </DropdownMenuItem>
                    {canManage && (
                      <>
                        <DropdownMenuItem onClick={() => hide(item)}>
                          {t("settings:projectPublish.moderation.hide")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleting(item)}
                        >
                          {t("settings:projectPublish.moderation.delete")}
                        </DropdownMenuItem>
                        {item.author && item.author.kind !== "member" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                item.author &&
                                setBlocking({
                                  userId: item.author.id,
                                  name: item.author.name,
                                })
                              }
                            >
                              {t("settings:projectPublish.moderation.block")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
        {comments.hasNextPage && (
          <div className="border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={comments.isFetchingNextPage}
              onClick={() => void comments.fetchNextPage()}
            >
              {t("settings:projectPublish.moderation.loadMore")}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectPublish.moderation.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectPublish.moderation.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              {t("settings:projectPublish.moderation.deleteConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BlockPersonDialog
        projectId={projectId}
        target={blocking}
        onOpenChange={(open) => {
          if (!open) setBlocking(null);
        }}
      />
    </section>
  );
}
