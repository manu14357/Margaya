import {
  Copy,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import {
  useDuplicateView,
  useSetViewLock,
} from "@/hooks/mutations/view/use-view-mutations";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateLink } from "@/lib/generate-link";
import { toast } from "@/lib/toast";
import { viewPath } from "@/lib/view/entity-link";
import { type ViewMenuItem, viewMenuItems } from "@/lib/view/menu";
import type { SavedView } from "@/types/view";
import DeleteViewDialog from "./delete-view-dialog";
import ViewFormDialog from "./view-form-dialog";

type ViewRowActionsProps = {
  view: SavedView;
  /** Runs after a delete, e.g. to leave the view's page. */
  onDeleted?: () => void;
  /** Opens the copy once it exists. */
  onDuplicated?: (copy: SavedView) => void;
  className?: string;
};

const ICONS: Record<ViewMenuItem, typeof Pencil> = {
  edit: Pencil,
  duplicate: Copy,
  copyLink: Link2,
  lock: Lock,
  unlock: LockOpen,
  delete: Trash2,
};

/** The "⋯" menu of a saved view, with its dialogs (B4 §6.7). */
export default function ViewRowActions({
  view,
  onDeleted,
  onDuplicated,
  className,
}: ViewRowActionsProps) {
  const { t } = useTranslation();
  const { canCreateViews, isCheckingPermissions } = useWorkspacePermission();
  const duplicate = useDuplicateView();
  const setLock = useSetViewLock();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);

  const entries = viewMenuItems({
    canEdit: view.canEdit,
    canDelete: view.canDelete,
    canCreate: !isCheckingPermissions && canCreateViews(),
    isLocked: view.isLocked,
  });

  const labels: Record<ViewMenuItem, string> = {
    edit: t("views:actions.edit"),
    duplicate: t("views:actions.duplicate"),
    copyLink: t("views:actions.copyLink"),
    lock: t("views:lock.lock"),
    unlock: t("views:lock.unlock"),
    delete: t("views:actions.delete"),
  };

  const run = (item: ViewMenuItem) => {
    switch (item) {
      case "edit":
        setDialog("edit");
        return;
      case "delete":
        setDialog("delete");
        return;
      case "copyLink":
        void copyToClipboard(
          generateLink(viewPath(view.workspaceId, view.id, view.projectId)),
        ).then((copied) => {
          if (copied) toast.success(t("views:toast.linkCopied"));
        });
        return;
      case "duplicate":
        duplicate.mutate(
          {
            viewId: view.id,
            name: t("views:copySuffix", { name: view.name }).slice(0, 255),
          },
          {
            onSuccess: (copy) => {
              toast.success(t("views:toast.duplicated"));
              onDuplicated?.(copy);
            },
            onError: (error) =>
              toast.error(error.message || t("views:toast.saveError")),
          },
        );
        return;
      case "lock":
      case "unlock":
        setLock.mutate(
          { viewId: view.id, locked: item === "lock" },
          {
            onSuccess: () =>
              toast.success(
                item === "lock"
                  ? t("views:lock.toastLocked")
                  : t("views:lock.toastUnlocked"),
              ),
            onError: (error) =>
              toast.error(error.message || t("views:toast.saveError")),
          },
        );
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("views:actions.menu")}
              className={className}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onClick={(event) => event.stopPropagation()}
        >
          <FavoriteButton
            variant="menu-item"
            workspaceId={view.workspaceId}
            entityType="view"
            entityId={view.id}
            placeholder={{
              name: view.name,
              projectId: view.projectId,
              ...(view.projectId ? { feature: "views" } : {}),
            }}
          />
          <DropdownMenuSeparator />
          {entries.map((entry) => {
            const Icon = ICONS[entry.item];
            return (
              <DropdownMenuItem
                key={entry.item}
                disabled={entry.disabled}
                title={entry.reasonKey ? t(entry.reasonKey) : undefined}
                onClick={() => run(entry.item)}
                className={
                  entry.item === "delete" ? "text-destructive" : undefined
                }
              >
                <Icon />
                {labels[entry.item]}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <ViewFormDialog
        open={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
        workspaceId={view.workspaceId}
        projectId={view.projectId}
        view={view}
      />
      <DeleteViewDialog
        view={view}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        onDeleted={onDeleted}
      />
    </>
  );
}
