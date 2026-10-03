import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { usePublicBoardCommentMutations } from "@/hooks/mutations/public-board/use-public-board-comments";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { PublicComment, PublicReactionGroup } from "@/types/public-board";
import PublicReactionBar from "./public-reaction-bar";

type PublicCommentCardProps = {
  token: string;
  number: number;
  comment: PublicComment;
  showReactions: boolean;
  canReact: boolean;
  onToggleReaction: (
    commentId: string,
    emoji: PublicReactionGroup["emoji"],
    reacted: boolean,
  ) => void;
};

/** A public comment: author, badge, time, markdown body and reactions. */
export default function PublicCommentCard({
  token,
  number,
  comment,
  showReactions,
  canReact,
  onToggleReaction,
}: PublicCommentCardProps) {
  const { t } = useTranslation();
  const { update, remove } = usePublicBoardCommentMutations(token, number);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { author } = comment;

  const save = () => {
    if (!draft.trim() || update.isPending) return;
    update.mutate(
      { commentId: comment.id, content: draft },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t("publicProject:comments.saved"));
        },
        onError: (error) =>
          toast.error(error.message || t("publicProject:comments.saveError")),
      },
    );
  };

  const cancel = () => {
    setDraft(comment.content);
    setEditing(false);
  };

  const confirmRemove = () => {
    setConfirmDelete(false);
    remove.mutate(comment.id, {
      onSuccess: () => toast.success(t("publicProject:comments.deleted")),
      onError: (error) =>
        toast.error(error.message || t("publicProject:comments.deleteError")),
    });
  };

  return (
    <article className="group relative rounded-xl border border-border/80 bg-card/60">
      <header className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
        <Avatar className="size-6">
          <AvatarImage src={author.image ?? ""} alt="" />
          <AvatarFallback className="bg-muted text-[10px]">
            {getInitials(author.name)}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium text-foreground/92 text-sm">
          {author.name}
        </span>
        {author.badge === "member" && (
          <Badge variant="secondary" size="sm">
            {t("publicProject:comments.badgeMember")}
          </Badge>
        )}
        {author.badge === "guest" && (
          <Badge variant="outline" size="sm">
            {t("publicProject:comments.badgeGuest")}
          </Badge>
        )}
        {author.isYou && (
          <span className="text-muted-foreground text-xs">
            ({t("publicProject:comments.you")})
          </span>
        )}
        <time
          dateTime={comment.createdAt}
          title={formatDateTime(comment.createdAt)}
          className="text-muted-foreground/62 text-xs"
        >
          {formatRelativeTime(comment.createdAt)}
        </time>
        {comment.edited && (
          <span className="text-muted-foreground/62 text-xs">
            · {t("publicProject:comments.edited")}
          </span>
        )}
        {!editing && (comment.can.edit || comment.can.delete) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
                  aria-label={t("publicProject:comments.actions")}
                />
              }
            >
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {comment.can.edit && (
                <DropdownMenuItem
                  onClick={() => {
                    setDraft(comment.content);
                    setEditing(true);
                  }}
                >
                  {t("publicProject:comments.edit")}
                </DropdownMenuItem>
              )}
              {comment.can.delete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("publicProject:comments.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {editing ? (
        <div className="pt-1">
          <CommentEditor
            value={draft}
            onChange={setDraft}
            allowFileUploads={false}
            showQuickAttachButton={false}
            autoFocus
            onSubmitShortcut={save}
            onCancelShortcut={cancel}
            className="[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-2 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2"
          />
          <div className="flex items-center justify-end gap-2 border-border/70 border-t px-3 py-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={cancel}
              disabled={update.isPending}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={save}
              disabled={update.isPending || !draft.trim()}
            >
              {t("publicProject:comments.save")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-3 pt-1.5 pb-2.5 text-sm">
          <MarkdownRenderer content={comment.content} />
        </div>
      )}

      {!editing && showReactions && (
        <PublicReactionBar
          groups={comment.reactions ?? []}
          canReact={canReact}
          onToggle={(emoji, reacted) =>
            onToggleReaction(comment.id, emoji, reacted)
          }
          className="px-3 pb-2.5"
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("publicProject:comments.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("publicProject:comments.deleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={confirmRemove}>
              {t("publicProject:comments.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
