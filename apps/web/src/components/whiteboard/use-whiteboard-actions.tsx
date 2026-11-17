import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteWhiteboard,
  useDuplicateWhiteboard,
  useSetWhiteboardArchived,
  useSetWhiteboardLock,
  useUpdateWhiteboard,
} from "@/hooks/mutations/whiteboard/use-whiteboard-mutations";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { openInNewWindow } from "@/lib/desktop-new-window";
import { generateLink } from "@/lib/generate-link";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import { whiteboardPath } from "@/lib/whiteboards/whiteboard-paths";
import type {
  WhiteboardCapabilities,
  WhiteboardSummary,
} from "@/types/whiteboard";
import DeleteWhiteboardDialog from "./delete-whiteboard-dialog";
import RenameWhiteboardDialog from "./rename-whiteboard-dialog";
import ShareWhiteboardDialog from "./share-whiteboard-dialog";
import WhiteboardIconDialog from "./whiteboard-icon-dialog";

type Options = {
  board: WhiteboardSummary;
  capabilities: WhiteboardCapabilities;
  workspaceId: string;
  /** After a move to the trash (the open board leaves for the list). */
  onDeleted?: () => void;
};

type DialogId = "rename" | "icon" | "share" | "delete";

/**
 * Everything the board menus can do (card, header and palette share it),
 * with their toasts and dialogs. Render `dialogs` outside any menu: menus
 * unmount when they close.
 */
export function useWhiteboardActions({
  board,
  capabilities,
  workspaceId,
  onDeleted,
}: Options) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const update = useUpdateWhiteboard();
  const duplicate = useDuplicateWhiteboard();
  const setLock = useSetWhiteboardLock();
  const setArchived = useSetWhiteboardArchived();
  const remove = useDeleteWhiteboard();
  const target = { whiteboardId: board.id, projectId: board.projectId };
  const untitled = t("whiteboards:list.untitled");
  const title = board.title.trim() || untitled;
  const path = whiteboardPath(workspaceId, board.projectId, board.id);

  const fail = (fallback: string) => (error: Error) =>
    toast.error(pageErrorMessage(error) ?? fallback);

  const openBoard = (whiteboardId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/whiteboards/$whiteboardId",
      params: { workspaceId, projectId: board.projectId, whiteboardId },
    });

  const closeDialog = (open: boolean, id: DialogId) =>
    setDialog(open ? id : null);

  return {
    open: () => openBoard(board.id),
    openInNewTab: () => {
      // The desktop app has windows, not tabs (the item says so there).
      if (openInNewWindow(path)) return;
      window.open(generateLink(path), "_blank", "noopener,noreferrer");
    },
    copyLink: async () => {
      if (await copyToClipboard(generateLink(path))) {
        toast.success(t("whiteboards:toasts.linkCopied"));
      }
    },
    rename: (next: string) =>
      update.mutate(
        { ...target, title: next },
        { onError: fail(t("whiteboards:toasts.renameError")) },
      ),
    setIcon: (icon: string | null) =>
      update.mutate(
        { ...target, icon },
        { onError: fail(t("whiteboards:toasts.iconError")) },
      ),
    duplicate: () =>
      duplicate.mutate(
        {
          ...target,
          title: t("whiteboards:dialogs.duplicate.copyTitle", { title }),
        },
        {
          onSuccess: (copy) =>
            toast.success(t("whiteboards:toasts.duplicated"), {
              action: {
                label: t("whiteboards:toasts.open"),
                onClick: () => openBoard(copy.id),
              },
            }),
          onError: fail(t("whiteboards:toasts.duplicateError")),
        },
      ),
    toggleLock: () => {
      const locked = !board.isLocked;
      setLock.mutate(
        { ...target, locked },
        {
          onSuccess: () =>
            toast.success(
              locked
                ? t("whiteboards:toasts.locked")
                : t("whiteboards:toasts.unlocked"),
            ),
          onError: fail(t("whiteboards:toasts.lockError")),
        },
      );
    },
    toggleArchive: () => {
      const archived = !board.archivedAt;
      setArchived.mutate(
        { ...target, archived },
        {
          onSuccess: () =>
            toast.success(
              archived
                ? t("whiteboards:toasts.archived")
                : t("whiteboards:toasts.unarchived"),
            ),
          onError: fail(
            archived
              ? t("whiteboards:toasts.archiveError")
              : t("whiteboards:toasts.unarchiveError"),
          ),
        },
      );
    },
    openRename: () => setDialog("rename"),
    openIcon: () => setDialog("icon"),
    openShare: () => setDialog("share"),
    openDelete: () => setDialog("delete"),
    isDuplicating: duplicate.isPending,
    dialogs: (
      <>
        {capabilities.canEdit && (
          <>
            <RenameWhiteboardDialog
              open={dialog === "rename"}
              onOpenChange={(open) => closeDialog(open, "rename")}
              title={board.title}
              onRename={(next) =>
                update.mutate(
                  { ...target, title: next },
                  { onError: fail(t("whiteboards:toasts.renameError")) },
                )
              }
            />
            <WhiteboardIconDialog
              open={dialog === "icon"}
              onOpenChange={(open) => closeDialog(open, "icon")}
              current={board.icon}
              onChoose={(icon) =>
                update.mutate(
                  { ...target, icon },
                  { onError: fail(t("whiteboards:toasts.iconError")) },
                )
              }
            />
          </>
        )}
        {capabilities.canPublish && (
          <ShareWhiteboardDialog
            board={board}
            canPublish={capabilities.canPublish}
            open={dialog === "share"}
            onOpenChange={(open) => closeDialog(open, "share")}
          />
        )}
        {capabilities.canManage && (
          <DeleteWhiteboardDialog
            open={dialog === "delete"}
            onOpenChange={(open) => closeDialog(open, "delete")}
            title={title}
            pending={remove.isPending}
            onConfirm={() =>
              remove.mutate(target, {
                onSuccess: () => {
                  toast.success(t("whiteboards:toasts.deleted"));
                  setDialog(null);
                  onDeleted?.();
                },
                onError: fail(t("whiteboards:toasts.deleteError")),
              })
            }
          />
        )}
      </>
    ),
  };
}

export type WhiteboardActions = ReturnType<typeof useWhiteboardActions>;
