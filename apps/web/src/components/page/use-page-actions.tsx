import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import { useDuplicatePage } from "@/hooks/mutations/page/use-duplicate-page";
import { useSetPageArchived } from "@/hooks/mutations/page/use-set-page-archived";
import { useSetPageLock } from "@/hooks/mutations/page/use-set-page-lock";
import { useUpdatePageAccess } from "@/hooks/mutations/page/use-update-page-access";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateLink } from "@/lib/generate-link";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { pagePath } from "@/lib/pages/page-paths";
import { toast } from "@/lib/toast";
import type { PageSummary } from "@/types/page";
import DeletePageDialog from "./delete-page-dialog";
import MovePageDialog from "./move-page-dialog";

type Options = {
  page: PageSummary;
  workspaceId: string;
  /** After a delete (the open page leaves for the Archived tab). */
  onDeleted?: () => void;
  /** After a move (the open page follows to its new URL). */
  onMoved?: (projectId: string) => void;
};

/**
 * Everything the page menus can do (row, tree and header menus share it),
 * with the toasts of §1.3 and the delete and move dialogs. Render `dialogs`
 * outside any menu: menus unmount when they close.
 */
export function usePageActions({
  page,
  workspaceId,
  onDeleted,
  onMoved,
}: Options) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = page.projectId ?? "";
  const [dialog, setDialog] = useState<"delete" | "move" | null>(null);
  const duplicate = useDuplicatePage();
  const setLock = useSetPageLock();
  const setAccess = useUpdatePageAccess();
  const setArchived = useSetPageArchived();
  const createPage = useCreatePage();
  const path = pagePath(workspaceId, projectId, page.id);

  const openPage = (pageId: string) =>
    navigate({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
      params: { workspaceId, projectId, pageId },
    });

  const fail = (fallbackKey: string) => (error: Error) =>
    toast.error(pageErrorMessage(error) ?? t(fallbackKey));

  return {
    openInNewTab: () => {
      window.open(generateLink(path), "_blank", "noopener,noreferrer");
    },
    copyLink: async () => {
      if (await copyToClipboard(generateLink(path))) {
        toast.success(t("pages:toasts.linkCopied"));
      }
    },
    duplicate: () =>
      duplicate.mutate(
        { pageId: page.id, projectId },
        {
          onSuccess: (copy) =>
            toast.success(t("pages:toasts.duplicated"), {
              action: {
                label: t("pages:toasts.open"),
                onClick: () => openPage(copy.id),
              },
            }),
          onError: fail("pages:toasts.duplicateError"),
        },
      ),
    toggleLock: () => {
      const locked = !page.isLocked;
      setLock.mutate(
        { pageId: page.id, projectId, locked },
        {
          onSuccess: () =>
            toast.success(
              locked ? t("pages:toasts.locked") : t("pages:toasts.unlocked"),
            ),
          onError: fail("pages:toasts.lockError"),
        },
      );
    },
    toggleAccess: () => {
      const access = page.access === "private" ? "public" : "private";
      setAccess.mutate(
        { pageId: page.id, projectId, access },
        {
          onSuccess: () =>
            toast.success(
              access === "private"
                ? t("pages:toasts.madePrivate")
                : t("pages:toasts.madePublic"),
            ),
          onError: fail("pages:toasts.accessError"),
        },
      );
    },
    toggleArchive: () => {
      const archived = !page.archivedAt;
      setArchived.mutate(
        { pageId: page.id, projectId, archived },
        {
          onSuccess: () =>
            toast.success(
              archived
                ? t("pages:toasts.archived")
                : t("pages:toasts.restored"),
            ),
          onError: fail(
            archived
              ? "pages:toasts.archiveError"
              : "pages:toasts.restoreError",
          ),
        },
      );
    },
    newSubpage: () =>
      createPage.mutate(
        { projectId, parentId: page.id },
        {
          onSuccess: (child) => openPage(child.id),
          onError: fail("pages:toasts.createError"),
        },
      ),
    openMove: () => setDialog("move"),
    openDelete: () => setDialog("delete"),
    isCreatingSubpage: createPage.isPending,
    dialogs: (
      <>
        {page.capabilities.canDelete && (
          <DeletePageDialog
            page={page}
            open={dialog === "delete"}
            onOpenChange={(open) => setDialog(open ? "delete" : null)}
            onDeleted={onDeleted}
          />
        )}
        {page.capabilities.canMove && (
          <MovePageDialog
            page={page}
            workspaceId={workspaceId}
            open={dialog === "move"}
            onOpenChange={(open) => setDialog(open ? "move" : null)}
            onMoved={onMoved}
          />
        )}
      </>
    ),
  };
}

export type PageActions = ReturnType<typeof usePageActions>;
