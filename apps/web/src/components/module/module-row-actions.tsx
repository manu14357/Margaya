import {
  Archive,
  ArchiveRestore,
  Link2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import OpenInAnalyticsItem from "@/components/analytics/open-in-analytics-item";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useArchiveModule } from "@/hooks/mutations/module/use-archive-module";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { generateLink } from "@/lib/generate-link";
import { modulePath } from "@/lib/module/entity-link";
import {
  canArchiveModule,
  canDeleteModule,
  canEditModule,
} from "@/lib/module/status";
import { toast } from "@/lib/toast";
import type { Module, ModuleDetail } from "@/types/module";
import ArchiveModuleDialog from "./archive-module-dialog";
import DeleteModuleDialog from "./delete-module-dialog";
import ModuleFormDialog from "./module-form-dialog";

type ModuleRowActionsProps = {
  module: Module | ModuleDetail;
  workspaceId: string;
  /** Runs after a delete, e.g. to leave the module's page. */
  onDeleted?: () => void;
  className?: string;
};

/** The "⋯" menu of a module, with its dialogs. */
export default function ModuleRowActions({
  module,
  workspaceId,
  onDeleted,
  className,
}: ModuleRowActionsProps) {
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const {
    canUpdateModules,
    canDeleteModules,
    canReadAnalytics,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const restore = useArchiveModule();
  const [dialog, setDialog] = useState<"edit" | "archive" | "delete" | null>(
    null,
  );

  const canUpdate = !isCheckingPermissions && canUpdateModules();
  const isArchived = !canEditModule(module);
  const archivable = canArchiveModule(module);
  const showEdit = canUpdate && !isArchived;
  const showDelete =
    !isCheckingPermissions &&
    canDeleteModule(module, {
      canDeleteModules: canDeleteModules(),
      canUpdateModules: canUpdateModules(),
      userId: session?.user?.id,
    });

  const handleCopyLink = async () => {
    const copied = await copyToClipboard(
      generateLink(modulePath(workspaceId, module.projectId, module.id)),
    );
    if (copied) toast.success(t("modules:toast.linkCopied"));
  };

  const handleRestore = () => {
    restore.mutate(
      { moduleId: module.id, projectId: module.projectId, archive: false },
      {
        onSuccess: () => toast.success(t("modules:toast.restored")),
        onError: (error) =>
          toast.error(error.message || t("modules:toast.restoreError")),
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
              aria-label={t("modules:actions.menu")}
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
              {t("modules:actions.edit")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void handleCopyLink()}>
            <Link2 />
            {t("modules:actions.copyLink")}
          </DropdownMenuItem>
          {!isCheckingPermissions && canReadAnalytics() && (
            <OpenInAnalyticsItem
              workspaceId={workspaceId}
              projectId={module.projectId}
              moduleId={module.id}
            />
          )}
          {canUpdate && !isArchived && (
            <DropdownMenuItem
              disabled={!archivable}
              onClick={() => setDialog("archive")}
              className="items-start"
            >
              <Archive />
              <span className="flex flex-col">
                <span>{t("modules:actions.archive")}</span>
                {!archivable && (
                  <span className="text-muted-foreground text-xs">
                    {t("modules:actions.archiveDisabledHint")}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          )}
          {canUpdate && isArchived && (
            <DropdownMenuItem onClick={handleRestore}>
              <ArchiveRestore />
              {t("modules:actions.restore")}
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
                {t("modules:actions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {showEdit && (
        <ModuleFormDialog
          open={dialog === "edit"}
          onOpenChange={(open) => setDialog(open ? "edit" : null)}
          projectId={module.projectId}
          workspaceId={workspaceId}
          module={module}
        />
      )}
      {canUpdate && archivable && (
        <ArchiveModuleDialog
          module={module}
          open={dialog === "archive"}
          onOpenChange={(open) => setDialog(open ? "archive" : null)}
        />
      )}
      {showDelete && (
        <DeleteModuleDialog
          module={module}
          open={dialog === "delete"}
          onOpenChange={(open) => setDialog(open ? "delete" : null)}
          onDeleted={onDeleted}
        />
      )}
    </>
  );
}
