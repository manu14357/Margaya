import { type ReactNode, useState } from "react";
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
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/menu";
import { usePublicCommentModeration } from "@/hooks/mutations/publication/use-public-comment-moderation";
import { toast } from "@/lib/toast";
import type { CommentVisibility, PublicAuthorKind } from "@/types/publication";
import BlockPersonDialog, { type BlockTarget } from "./block-person-dialog";

/** The project's board as far as one task's comments are concerned. */
export type CommentPublicBoard = {
  projectId: string;
  /** Published with comments on: authors may make their comments public. */
  open: boolean;
  /** project:share: hide, delete and block on others' public comments. */
  canModerate: boolean;
};

export type CommentPublicActionInput = {
  visibility: CommentVisibility;
  isAuthor: boolean;
  authorKind?: PublicAuthorKind;
  authorId?: string | null;
  /** Imported comments (GitHub, Jira…) never go public. */
  imported: boolean;
  publicBoard?: CommentPublicBoard;
  /** A reply's top-level comment: a reply goes public only under a public one. */
  parentVisibility?: CommentVisibility;
};

/** Which public-board actions a comment's "⋯" menu offers (B12 §1.6). */
export function commentPublicActions({
  visibility,
  isAuthor,
  authorKind,
  authorId,
  imported,
  publicBoard,
  parentVisibility,
}: CommentPublicActionInput) {
  const isPublic = visibility === "public";
  const moderator = Boolean(publicBoard?.canModerate) && !isAuthor;
  return {
    makePublic:
      isAuthor &&
      !isPublic &&
      !imported &&
      Boolean(publicBoard?.open) &&
      parentVisibility !== "internal",
    makeInternal: isAuthor && isPublic,
    hide: moderator && isPublic,
    remove: moderator && isPublic,
    block:
      moderator &&
      Boolean(authorId) &&
      (authorKind === "external" || authorKind === "guest"),
  };
}

export function hasCommentPublicActions(input: CommentPublicActionInput) {
  return Object.values(commentPublicActions(input)).some(Boolean);
}

type CommentPublicActionsProps = CommentPublicActionInput & {
  commentId: string;
  taskId: string;
  authorName: string;
  /**
   * Renders the comment's own "⋯" menu with these items in it. The confirm
   * and block dialogs stay out here, so they outlast the closed menu.
   */
  children: (items: ReactNode) => ReactNode;
};

/** Make public / internal, Hide from board, Delete and Block, as menu items. */
export default function CommentPublicActions({
  commentId,
  taskId,
  authorName,
  children,
  ...input
}: CommentPublicActionsProps) {
  const { t } = useTranslation();
  const projectId = input.publicBoard?.projectId ?? "";
  const { setVisibility, remove } = usePublicCommentModeration(projectId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blocking, setBlocking] = useState<BlockTarget | null>(null);
  const actions = commentPublicActions(input);

  const changeVisibility = (visibility: CommentVisibility, done: string) =>
    setVisibility.mutate(
      { commentId, taskId, visibility },
      {
        onSuccess: () => toast.success(done),
        onError: (error) =>
          toast.error(error.message || t("activity:commentVisibility.error")),
      },
    );

  const handleDelete = () => {
    setConfirmDelete(false);
    remove.mutate(
      { commentId, taskId },
      {
        onSuccess: () =>
          toast.success(t("activity:commentVisibility.moderatorDeleted")),
        onError: (error) =>
          toast.error(
            error.message ||
              t("activity:commentVisibility.moderatorDeleteError"),
          ),
      },
    );
  };

  const items = (
    <>
      <DropdownMenuSeparator />
      {actions.makePublic && (
        <DropdownMenuItem
          onClick={() =>
            changeVisibility(
              "public",
              t("activity:commentVisibility.madePublic"),
            )
          }
        >
          {t("activity:commentVisibility.makePublic")}
        </DropdownMenuItem>
      )}
      {actions.makeInternal && (
        <DropdownMenuItem
          onClick={() =>
            changeVisibility(
              "internal",
              t("activity:commentVisibility.madeInternal"),
            )
          }
        >
          {t("activity:commentVisibility.makeInternal")}
        </DropdownMenuItem>
      )}
      {actions.hide && (
        <DropdownMenuItem
          onClick={() =>
            changeVisibility(
              "internal",
              t("settings:projectPublish.moderation.hidden"),
            )
          }
        >
          {t("activity:commentVisibility.hideFromBoard")}
        </DropdownMenuItem>
      )}
      {actions.remove && (
        <DropdownMenuItem
          variant="destructive"
          onClick={() => setConfirmDelete(true)}
        >
          {t("activity:commentVisibility.moderatorDelete")}
        </DropdownMenuItem>
      )}
      {actions.block && input.authorId && (
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            input.authorId &&
            setBlocking({ userId: input.authorId, name: authorName })
          }
        >
          {t("activity:commentVisibility.blockFromBoard")}
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <>
      {children(items)}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
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
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              {t("settings:projectPublish.moderation.deleteConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {projectId && (
        <BlockPersonDialog
          projectId={projectId}
          target={blocking}
          onOpenChange={(open) => {
            if (!open) setBlocking(null);
          }}
        />
      )}
    </>
  );
}
