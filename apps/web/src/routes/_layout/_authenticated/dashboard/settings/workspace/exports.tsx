import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPage, SettingsSection } from "@/components/settings-layout";
import { ExportFormDialog } from "@/components/task-export/export-form-dialog";
import { ExportHistory } from "@/components/task-export/export-history";
import { WorkspaceExportDialog } from "@/components/task-export/workspace-export-dialog";
import { Button } from "@/components/ui/button";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/exports",
)({
  component: RouteComponent,
});

const DEFAULT_RETENTION_DAYS = 7;

/** Settings → Workspace → Exports: start an export, see and download files. */
function RouteComponent() {
  const { t } = useTranslation();
  const {
    workspace,
    canManageWebhooks,
    canReadPages,
    canDeletePages,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const { data: config } = useGetConfig();
  const [formOpen, setFormOpen] = useState(false);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  // workspace:manage_settings; the API enforces it for every export route.
  const canManageSettings = !isCheckingPermissions && canManageWebhooks();
  // A whole-workspace archive also holds pages; the API checks all of it
  // (WORKSPACE_EXPORT_PERMISSIONS).
  const canExportWorkspace =
    canManageSettings && canReadPages() && canDeletePages();
  const retentionDays = config?.exportRetentionDays ?? DEFAULT_RETENTION_DAYS;
  const workspaceId = workspace?.id;

  return (
    <SettingsPage
      title={t("settings:workspaceExports.title")}
      documentTitle={t("settings:workspaceExports.pageTitle")}
      description={t("settings:workspaceExports.subtitle", {
        days: retentionDays,
      })}
      actions={
        <Button
          size="sm"
          onClick={() => setFormOpen(true)}
          disabled={!workspaceId}
        >
          <Plus />
          {t("settings:workspaceExports.newExport")}
        </Button>
      }
    >
      {canExportWorkspace && (
        <SettingsSection
          title={t("settings:workspaceExports.whole.title")}
          description={t("settings:workspaceExports.whole.description")}
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => setWorkspaceDialogOpen(true)}
              disabled={!workspaceId}
            >
              {t("settings:workspaceExports.whole.action")}
            </Button>
          }
        >
          {null}
        </SettingsSection>
      )}

      <SettingsSection
        title={t("settings:workspaceExports.history.title")}
        description={t("settings:workspaceExports.history.description")}
      >
        {workspaceId && (
          // Polls while an export is still being prepared.
          <ExportHistory
            workspaceId={workspaceId}
            canSeeAll={canManageSettings}
            retentionDays={retentionDays}
          />
        )}
      </SettingsSection>

      {workspaceId && (
        <ExportFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          workspaceId={workspaceId}
        />
      )}
      {workspaceId && canExportWorkspace && (
        <WorkspaceExportDialog
          open={workspaceDialogOpen}
          onOpenChange={setWorkspaceDialogOpen}
          workspaceId={workspaceId}
        />
      )}
    </SettingsPage>
  );
}
