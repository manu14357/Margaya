import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import OpenInAnalyticsItem from "@/components/analytics/open-in-analytics-item";
import FavoriteButton from "@/components/favorite/favorite-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useArchiveCycle } from "@/hooks/mutations/cycle/use-archive-cycle";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { cyclePath } from "@/lib/cycle/entity-link";
import {
  canArchiveCycle,
  canDeleteCycle,
  canEditCycle,
  canTransfer,
} from "@/lib/cycle/status";
import { generateLink } from "@/lib/generate-link";
import { toast } from "@/lib/toast";
import type { Cycle } from "@/types/cycle";
import CycleFormDialog from "./cycle-form-dialog";
import DeleteCycleDialog from "./delete-cycle-dialog";
import TransferTasksDialog from "./transfer-tasks-dialog";

type CycleRowActionsProps = {
  cycle: Cycle;
  workspaceId: string;
  /** Runs after a delete, e.g. to leave the cycle's page. */
  onDeleted?: () => void;
  className?: string;
};

/** The "⋯" menu of a cycle, with its dialogs. */
export default function CycleRowActions({
  cycle,
  workspaceId,
  onDeleted,
  className,
}: CycleRowActionsProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const { canUpdateCycles, canDeleteCycles, canReadAnalytics } =
    useWorkspacePermission();
  const archive = useArchiveCycle();
  const [dialog, setDialog] = useState<"edit" | "delete" | "transfer" | null>(
    null,
  );

  const canUpdate = canUpdateCycles();
  const showEdit = canUpdate && canEditCycle(cycle);
  const showTransfer = canUpdate && canTransfer(cycle);
  const showDelete = canDeleteCycle(cycle, {
    canDeleteCycles: canDeleteCycles(),
    canUpdateCycles: canUpdate,
    userId: session?.user?.id,
  });
  const isArchived = Boolean(cycle.archivedAt);

  const handleCopyLink = async () => {
    const copied = await copyToClipboard(
      generateLink(cyclePath(workspaceId, cycle.projectId, cycle.id)),
    );
    if (copied) toast.success(t("cycles:toast.linkCopied"));
  };

  const handleArchive = (nextArchived: boolean) => {
    archive.mutate(
      { cycleId: cycle.id, projectId: cycle.projectId, archive: nextArchived },
      {
        onSuccess: () =>
          toast.success(
            nextArchived
              ? t("cycles:toast.archived")
              : t("cycles:toast.restored"),
          ),
        onError: (error) =>
          toast.error(
            error.message ||
              (nextArchived
                ? t("cycles:toast.archiveError")
                : t("cycles:toast.restoreError")),
          ),
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("cycles:actions.menu")}
              className={className}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onClick={(event) => event.stopPropagation()}
        >
          {showEdit && (
            <DropdownMenuItem onClick={() => setDialog("edit")}>
              <Pencil />
              {t("cycles:actions.edit")}
            </DropdownMenuItem>
          )}
          <FavoriteButton
            variant="menu-item"
            workspaceId={workspaceId}
            entityType="cycle"
            entityId={cycle.id}
            placeholder={{
              name: cycle.name,
              projectId: cycle.projectId,
              feature: "cycles",
            }}
          />
          <DropdownMenuItem onClick={() => void handleCopyLink()}>
            <Link2 />
            {t("cycles:actions.copyLink")}
          </DropdownMenuItem>
          {canReadAnalytics() && (
            <OpenInAnalyticsItem
              workspaceId={workspaceId}
              projectId={cycle.projectId}
              cycleId={cycle.id}
            />
          )}
          {showTransfer && (
            <DropdownMenuItem onClick={() => setDialog("transfer")}>
              <ArrowRightLeft />
              {t("cycles:actions.transfer", { count: cycle.pending })}
            </DropdownMenuItem>
          )}
          {canUpdate && !isArchived && (
            <DropdownMenuItem
              disabled={!canArchiveCycle(cycle)}
              onClick={() => handleArchive(true)}
              className="items-start"
            >
              <Archive />
              <span className="flex flex-col">
                <span>{t("cycles:actions.archive")}</span>
                {!canArchiveCycle(cycle) && (
                  <span className="text-muted-foreground text-xs">
                    {t("cycles:actions.archiveDisabledHint")}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )}
          {canUpdate && isArchived && (
            <DropdownMenuItem onClick={() => handleArchive(false)}>
              <ArchiveRestore />
              {t("cycles:actions.restore")}
            </DropdownMenuItem>
          )}
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDialog("delete")}
              >
                <Trash2 />
                {t("cycles:actions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showEdit && (
        <CycleFormDialog
          open={dialog === "edit"}
          onOpenChange={(open) => setDialog(open ? "edit" : null)}
          projectId={cycle.projectId}
          workspaceId={workspaceId}
          cycle={cycle}
        />
      )}
      {showTransfer && (
        <TransferTasksDialog
          cycle={cycle}
          workspaceId={workspaceId}
          open={dialog === "transfer"}
          onOpenChange={(open) => setDialog(open ? "transfer" : null)}
        />
      )}
      {showDelete && (
        <DeleteCycleDialog
          cycle={cycle}
          open={dialog === "delete"}
          onOpenChange={(open) => setDialog(open ? "delete" : null)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
