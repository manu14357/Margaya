import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import { GithubIcon } from "@/components/icons/github-icon";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import CommentPublicActions, {
  type CommentPublicBoard,
  hasCommentPublicActions,
} from "@/components/publication/comment-public-actions";
import CommentVisibilityBadge from "@/components/publication/comment-visibility-badge";
import ReactionBar from "@/components/reaction/reaction-bar";
import ReactionPicker from "@/components/reaction/reaction-picker";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/preview-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useDeleteComment from "@/hooks/mutations/comment/use-delete-comment";
import useUpdateComment from "@/hooks/mutations/comment/use-update-comment";
import useToggleReaction from "@/hooks/mutations/reaction/use-toggle-reaction";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type { CommentVisibility, PublicAuthorKind } from "@/types/publication";
import type { ReactionGroup } from "@/types/reaction";
import { isCommentEdited } from "./activity-feed-options";

type CommentCardProps = {
  commentId: string;
  taskId: string;
  content: string;
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  createdAt: string;
  /** Shows "(edited)" when it is meaningfully later than `createdAt`. */
  updatedAt?: string;
  importedBy?: string;
  externalSource?: string | null;
  externalUrl?: string | null;
  /** The comment's reaction groups; undefined until the task's load. */
  reactionGroups?: readonly ReactionGroup[];
  /** Public comments also show on the project's public board. */
  visibility?: CommentVisibility;
  /** Known once the author flags load: outsiders get a badge. */
  authorKind?: PublicAuthorKind;
  /** The project's public board, when it has one. */
  publicBoard?: CommentPublicBoard;
};

export default function CommentCard({
  commentId,
  taskId,
  content,
  user,
  createdAt,
  updatedAt,
  externalSource,
  externalUrl,
  importedBy,
  reactionGroups,
  visibility = "internal",
  authorKind,
  publicBoard,
}: CommentCardProps) {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(content);
  const { mutateAsync: updateComment, isPending } = useUpdateComment();
  const { mutate: deleteComment, isPending: isDeleting } =
    useDeleteComment(taskId);
  const queryClient = useQueryClient();
  const { toggle: toggleReaction } = useToggleReaction(taskId);

  const canEdit = currentUser?.id === user?.id;
  // Without reactions yet, every member reacts from the hover actions.
  const showHoverPicker =
    reactionGroups !== undefined && reactionGroups.length === 0;
  const publicActionInput = {
    visibility,
    isAuthor: canEdit,
    authorKind,
    authorId: user?.id ?? null,
    imported: Boolean(externalSource),
    publicBoard,
  };
  const showPublicActions = hasCommentPublicActions(publicActionInput);
  const sourceName =
    externalSource === "github"
      ? "GitHub"
      : externalSource === "trello"
        ? "Trello"
        : externalSource === "jira"
          ? "Jira"
          : externalSource;
  const isFromGitHub = externalSource === "github";
  const githubProfileUrl =
    isFromGitHub && user?.name ? `https://github.com/${user.name}` : null;
  const commentUrl = externalUrl || null;
  const fullTimestamp = formatDateTime(createdAt);
  const edited = isCommentEdited(createdAt, updatedAt);
  const editedLabel =
    edited && updatedAt
      ? t("activity:comment.editedAt", { time: formatDateTime(updatedAt) })
      : "";

  const handleEdit = useCallback(() => {
    setEditedContent(content);
    setIsEditing(true);
  }, [content]);

  const handleCancel = useCallback(() => {
    setEditedContent(content);
    setIsEditing(false);
  }, [content]);

  const handleSave = useCallback(async () => {
    if (!editedContent.trim()) {
      toast.error(t("activity:comment.cannotBeEmpty"));
      return;
    }

    if (!currentUser?.id) {
      toast.error(t("activity:comment.mustBeLoggedInToEdit"));
      return;
    }

    try {
      await updateComment({
        activityId: commentId,
        comment: editedContent,
      });

      setIsEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
      toast.success(t("activity:comment.updated"));
    } catch (error) {
      console.error("Failed to update comment:", error);
      toast.error(t("activity:comment.failedToUpdate"));
    }
  }, [
    commentId,
    currentUser?.id,
    editedContent,
    queryClient,
    t,
    taskId,
    updateComment,
  ]);

  return (
    <TooltipProvider>
      <div
        id={`comment-${commentId}`}
        className="group relative w-full scroll-mt-4 rounded-xl border border-border/80 bg-card/60 transition-shadow"
      >
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
          <HoverCard>
            <HoverCardTrigger>
              <div className="flex cursor-pointer items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user?.image ?? ""} alt={user?.name || ""} />
                  <AvatarFallback className="bg-muted text-xs font-medium">
                    {getInitials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-foreground/92 hover:text-foreground transition-colors">
                  {user?.name}
                </span>
              </div>
            </HoverCardTrigger>
            <HoverCardContent className="w-64 p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={user?.image ?? ""} alt={user?.name || ""} />
                  <AvatarFallback className="bg-muted text-xs font-medium">
                    {getInitials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-none">
                    {user?.name}
                  </p>
                  {user?.email && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  )}
                  {isFromGitHub && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <GithubIcon className="size-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {t("activity:comment.github")}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {githubProfileUrl && (
                <a
                  href={githubProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ExternalLink className="size-3" />
                  {t("activity:comment.viewGithubProfile")}
                </a>
              )}
            </HoverCardContent>
          </HoverCard>

          {(authorKind === "external" || authorKind === "guest") && (
            <CommentVisibilityBadge kind={authorKind} />
          )}
          {visibility === "public" && <CommentVisibilityBadge kind="public" />}

          {sourceName && (
            <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
              {t("activity:comment.importedFrom", { source: sourceName })}
              {importedBy &&
                ` · ${t("activity:comment.importedBy", { name: importedBy })}`}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="cursor-default text-xs text-muted-foreground/62 outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={fullTimestamp}
                title={fullTimestamp}
              >
                <time dateTime={createdAt}>
                  {formatRelativeTime(createdAt)}
                </time>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{fullTimestamp}</p>
            </TooltipContent>
          </Tooltip>
          {edited && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="cursor-default text-xs text-muted-foreground/62 outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={editedLabel}
                  data-testid="comment-edited"
                >
                  {t("activity:comment.edited")}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{editedLabel}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {commentUrl && (
            <>
              <span className="text-xs text-muted-foreground/40">·</span>
              <a
                href={commentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <GithubIcon className="size-3" />
                {t("activity:comment.commentedOnGithub")}
              </a>
            </>
          )}
        </div>

        {!isEditing && (canEdit || showHoverPicker || showPublicActions) && (
          <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-popup-open]]:opacity-100">
            {showHoverPicker && (
              <ReactionPicker
                groups={[]}
                onPick={(emoji, reacted) =>
                  toggleReaction({ commentId, emoji, reacted })
                }
                triggerClassName="h-6 w-6 rounded-md"
              />
            )}
            {canEdit && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleEdit}
                      className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-foreground"
                      aria-label={t("activity:comment.edit")}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{t("activity:comment.edit")}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteComment({ activityId: commentId })}
                      disabled={isDeleting}
                      className="h-6 w-6 rounded-md p-0 text-muted-foreground hover:text-destructive"
                      aria-label={t("activity:comment.delete")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{t("common:actions.delete")}</p>
                  </TooltipContent>
                </Tooltip>
              </>
            )}
            {showPublicActions && (
              <CommentPublicActions
                commentId={commentId}
                taskId={taskId}
                authorName={user?.name ?? ""}
                {...publicActionInput}
              />
            )}
          </div>
        )}

        <div className="pt-0.5">
          <CommentEditor
            value={isEditing ? editedContent : content}
            onChange={isEditing ? setEditedContent : undefined}
            placeholder={t("activity:comment.editPlaceholder")}
            taskId={taskId}
            uploadSurface="comment"
            className={
              isEditing
                ? "[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.margaya-comment-editor-content_.ProseMirror]:max-h-none [&_.margaya-comment-editor-content_.ProseMirror]:overflow-visible [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-2.5 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2"
                : "margaya-comment-viewer [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-2 [&_.margaya-comment-editor-content_.ProseMirror]:pb-3"
            }
            autoFocus={isEditing}
            readOnly={!isEditing}
            onSubmitShortcut={isEditing ? handleSave : undefined}
            onCancelShortcut={isEditing ? handleCancel : undefined}
          />
        </div>

        {!isEditing && reactionGroups && reactionGroups.length > 0 && (
          <ReactionBar
            taskId={taskId}
            commentId={commentId}
            groups={reactionGroups}
            className="px-3 pb-2.5"
          />
        )}

        {isEditing && (
          <div className="flex items-center justify-end gap-2 border-border/70 border-t bg-card/60 px-3 py-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCancel}
              disabled={isPending}
              className="h-7 px-2.5 text-xs"
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleSave}
              disabled={isPending || !editedContent.trim()}
              className="h-7 px-2.5 text-xs"
            >
              {t("activity:comment.save")}
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
