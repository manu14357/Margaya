import { useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Link2,
  MoreHorizontal,
  Pencil,
  Reply,
  Trash2,
} from "lucide-react";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";
import TranslatableContent from "@/components/ai/translate/translatable-content";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
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
import { cn } from "@/lib/cn";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { keepAnchorInView } from "@/lib/keep-anchor-in-view";
import { taskUrl } from "@/lib/task-key";
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
  /** A reply's top-level comment's visibility; undefined for top-level. */
  parentVisibility?: CommentVisibility;
  /**
   * `card` is a top-level comment in its own bordered card; `reply` is a
   * compact row inside its parent's card.
   */
  variant?: "card" | "reply";
  /** Shown after the author's name, such as an agent's attribution. */
  badges?: ReactNode;
  /** Offers Reply in the card's footer and menu (top-level comments). */
  onReply?: () => void;
  /** The Reply action's accessible name, such as "Reply to Mia". */
  replyLabel?: string;
  /** The footer's Reply button: focus returns here when a reply closes. */
  replyButtonRef?: Ref<HTMLButtonElement>;
  /** With the cached task's project, Copy link points at the task page. */
  workspaceId?: string;
  /** The comment's thread, inside the card below its footer. */
  children?: ReactNode;
};

const SOURCE_NAMES: Record<string, string> = {
  github: "GitHub",
  trello: "Trello",
  jira: "Jira",
  linear: "Linear",
  asana: "Asana",
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
  parentVisibility,
  variant = "card",
  badges,
  onReply,
  replyLabel,
  replyButtonRef,
  workspaceId,
  children,
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
  const rootRef = useRef<HTMLDivElement>(null);
  const isReply = variant === "reply";

  const canEdit = Boolean(user?.id) && currentUser?.id === user?.id;
  const visibleReactions =
    reactionGroups?.filter((group) => group.count > 0) ?? [];
  const publicActionInput = {
    visibility,
    isAuthor: canEdit,
    authorKind,
    authorId: user?.id ?? null,
    imported: Boolean(externalSource),
    publicBoard,
    parentVisibility,
  };
  const showPublicActions = hasCommentPublicActions(publicActionInput);
  const sourceName = externalSource
    ? (SOURCE_NAMES[externalSource] ?? externalSource)
    : null;
  const isFromGitHub = externalSource === "github";
  const githubProfileUrl =
    isFromGitHub && user?.name ? `https://github.com/${user.name}` : null;
  const commentUrl = externalUrl || null;
  const fullTimestamp = formatDateTime(createdAt);
  const relativeTime = formatRelativeTime(createdAt);
  const edited = isCommentEdited(createdAt, updatedAt);
  const editedLabel =
    edited && updatedAt
      ? t("activity:comment.editedAt", { time: formatDateTime(updatedAt) })
      : "";
  const projectId = queryClient.getQueryData<{ projectId?: string }>([
    "task",
    taskId,
  ])?.projectId;

  // A copied comment link opens the task scrolled to its comment, and keeps
  // it there while the rest of the task page loads above it.
  useEffect(() => {
    if (window.location.hash !== `#comment-${commentId}`) return;
    const node = rootRef.current;
    if (!node) return;
    return keepAnchorInView(node);
  }, [commentId]);

  const handleEdit = useCallback(() => {
    setEditedContent(content);
    setIsEditing(true);
  }, [content]);

  const handleCancel = useCallback(() => {
    setEditedContent(content);
    setIsEditing(false);
  }, [content]);

  const handleCopyLink = useCallback(async () => {
    const page =
      workspaceId && projectId
        ? taskUrl({ workspaceId, projectId, taskId })
        : `${window.location.origin}${window.location.pathname}${window.location.search}`;
    if (await copyToClipboard(`${page}#comment-${commentId}`)) {
      toast.success(t("activity:comment.linkCopied"));
    } else {
      toast.error(t("tasks:taskKey.clipboardError"));
    }
  }, [commentId, projectId, t, taskId, workspaceId]);

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

  const avatar = (size: string) => (
    <Avatar className={size}>
      <AvatarImage src={user?.image ?? ""} alt={user?.name || ""} />
      <AvatarFallback className="bg-muted font-medium text-[10px]">
        {getInitials(user?.name)}
      </AvatarFallback>
    </Avatar>
  );

  const author = (
    <HoverCard>
      <HoverCardTrigger>
        <div className="flex cursor-pointer items-center gap-2">
          {avatar("size-5")}
          <span className="font-medium text-foreground/92 text-sm transition-colors hover:text-foreground">
            {user?.name}
          </span>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 p-3">
        <div className="flex items-center gap-3">
          {avatar("h-10 w-10")}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground text-sm leading-none">
              {user?.name}
            </p>
            {user?.email && (
              <p className="mt-1 text-muted-foreground text-xs">{user.email}</p>
            )}
            {isFromGitHub && (
              <div className="mt-1.5 flex items-center gap-1">
                <GithubIcon className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">
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
            className="mt-3 flex items-center gap-1.5 border-border border-t pt-3 text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3" />
            {t("activity:comment.viewGithubProfile")}
          </a>
        )}
      </HoverCardContent>
    </HoverCard>
  );

  const metaClass =
    "cursor-default text-muted-foreground text-xs outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  const meta = (
    <>
      {(authorKind === "external" || authorKind === "guest") && (
        <CommentVisibilityBadge kind={authorKind} />
      )}
      {visibility === "public" && <CommentVisibilityBadge kind="public" />}
      {sourceName && (
        <span className="rounded border px-1.5 py-0.5 text-muted-foreground text-xs">
          {t("activity:comment.importedFrom", { source: sourceName })}
          {importedBy &&
            ` · ${t("activity:comment.importedBy", { name: importedBy })}`}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={metaClass}
            aria-label={fullTimestamp}
          >
            <time dateTime={createdAt}>
              {isReply
                ? relativeTime
                : t("activity:comment.commentedAgo", { time: relativeTime })}
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
              className={metaClass}
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
        <a
          href={commentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
        >
          <GithubIcon className="size-3" />
          {t("activity:comment.commentedOnGithub")}
        </a>
      )}
    </>
  );

  const menu = (publicItems: ReactNode) => (
    <CommentActionsMenu
      onReply={onReply}
      onEdit={canEdit ? handleEdit : undefined}
      onCopyLink={handleCopyLink}
      onDelete={
        canEdit ? () => deleteComment({ activityId: commentId }) : undefined
      }
      deleting={isDeleting}
      publicItems={publicItems}
    />
  );

  const actions = !isEditing && (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        // Reply rows keep quiet until pointed at; touch always shows them.
        isReply &&
          "pointer-fine:opacity-0 transition-opacity pointer-fine:group-hover/reply:opacity-100 pointer-fine:focus-within:opacity-100 pointer-fine:has-[[data-popup-open]]:opacity-100",
      )}
    >
      {reactionGroups !== undefined && (
        <ReactionPicker
          groups={visibleReactions}
          onPick={(emoji, reacted) =>
            toggleReaction({ commentId, emoji, reacted })
          }
          triggerClassName="rounded-md"
        />
      )}
      {showPublicActions ? (
        <CommentPublicActions
          commentId={commentId}
          taskId={taskId}
          authorName={user?.name ?? ""}
          {...publicActionInput}
        >
          {menu}
        </CommentPublicActions>
      ) : (
        menu(null)
      )}
    </div>
  );

  const body = (
    <TranslatableContent
      kind="comment"
      id={commentId}
      text={content}
      projectId={projectId}
      auto
      hideToggle={isEditing}
      toggleClassName={isReply ? "pb-1" : "px-3 pb-2"}
    >
      {(shown) => (
        <CommentEditor
          value={isEditing ? editedContent : shown}
          onChange={isEditing ? setEditedContent : undefined}
          placeholder={t("activity:comment.editPlaceholder")}
          taskId={taskId}
          uploadSurface="comment"
          className={
            isEditing
              ? cn(
                  "[&_.margaya-comment-editor-content_.ProseMirror]:min-h-[3rem] [&_.margaya-comment-editor-content_.ProseMirror]:max-h-none [&_.margaya-comment-editor-content_.ProseMirror]:overflow-visible [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-2.5 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2",
                  isReply &&
                    "mt-1 rounded-lg border border-border/80 bg-background/60",
                )
              : isReply
                ? "margaya-comment-viewer [&_.margaya-comment-editor-content_.ProseMirror]:px-0 [&_.margaya-comment-editor-content_.ProseMirror]:pt-0.5 [&_.margaya-comment-editor-content_.ProseMirror]:pb-1"
                : "margaya-comment-viewer [&_.margaya-comment-editor-content_.ProseMirror]:px-3 [&_.margaya-comment-editor-content_.ProseMirror]:pt-1.5 [&_.margaya-comment-editor-content_.ProseMirror]:pb-2.5"
          }
          autoFocus={isEditing}
          readOnly={!isEditing}
          onSubmitShortcut={isEditing ? handleSave : undefined}
          onCancelShortcut={isEditing ? handleCancel : undefined}
        />
      )}
    </TranslatableContent>
  );

  const editFooter = isEditing && (
    <div
      className={cn(
        "flex items-center justify-end gap-2",
        isReply ? "pt-2" : "border-border/70 border-t bg-card/60 px-3 py-2",
      )}
    >
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
  );

  if (isReply) {
    return (
      <TooltipProvider>
        <div
          ref={rootRef}
          id={`comment-${commentId}`}
          className="group/reply scroll-mt-4 rounded-lg px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              {author}
              {badges}
              {meta}
            </div>
            {actions}
          </div>
          <div className="ps-7">
            {body}
            {!isEditing && visibleReactions.length > 0 && (
              <ReactionBar
                taskId={taskId}
                commentId={commentId}
                groups={visibleReactions}
                hidePicker
                className="pt-0.5 pb-1"
              />
            )}
            {editFooter}
          </div>
        </div>
      </TooltipProvider>
    );
  }

  const showFooter = !isEditing && (visibleReactions.length > 0 || onReply);

  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        id={`comment-${commentId}`}
        className="relative w-full scroll-mt-4 rounded-xl border border-border/80 bg-card/60"
      >
        <div className="flex items-center gap-2 ps-3 pe-2 pt-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            {author}
            {badges}
            {meta}
          </div>
          {actions}
        </div>

        {body}

        {showFooter && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
            {visibleReactions.length > 0 && (
              <ReactionBar
                taskId={taskId}
                commentId={commentId}
                groups={visibleReactions}
                hidePicker
              />
            )}
            {onReply && (
              <Button
                ref={replyButtonRef}
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label={replyLabel}
                onClick={onReply}
              >
                <Reply aria-hidden />
                {t("activity:comment.thread.reply")}
              </Button>
            )}
          </div>
        )}

        {editFooter}

        {children}
      </div>
    </TooltipProvider>
  );
}

/** The "⋯" menu: Reply, Edit, Copy link, the public-board items, Delete. */
function CommentActionsMenu({
  onReply,
  onEdit,
  onCopyLink,
  onDelete,
  deleting,
  publicItems,
}: {
  onReply?: () => void;
  onEdit?: () => void;
  onCopyLink: () => void;
  onDelete?: () => void;
  deleting: boolean;
  publicItems: ReactNode;
}) {
  const { t } = useTranslation();
  // Reply and Edit focus an editor: the closing menu must not take it back.
  const keepFocus = useRef(false);
  const focusElsewhere = (action: () => void) => () => {
    keepFocus.current = true;
    action();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-md text-muted-foreground hover:text-foreground"
            aria-label={t("activity:commentVisibility.moreActions")}
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        finalFocus={() => {
          const restore = !keepFocus.current;
          keepFocus.current = false;
          return restore;
        }}
      >
        {onReply && (
          <DropdownMenuItem onClick={focusElsewhere(onReply)}>
            <Reply aria-hidden />
            {t("activity:comment.thread.reply")}
          </DropdownMenuItem>
        )}
        {onEdit && (
          <DropdownMenuItem onClick={focusElsewhere(onEdit)}>
            <Pencil aria-hidden />
            {t("activity:comment.edit")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onCopyLink}>
          <Link2 aria-hidden />
          {t("tasks:contextMenu.copyLink")}
        </DropdownMenuItem>
        {publicItems}
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting}
              onClick={onDelete}
            >
              <Trash2 aria-hidden />
              {t("activity:comment.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
