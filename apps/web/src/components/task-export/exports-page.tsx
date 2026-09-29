import { FileDown, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { ExportFormDialog } from "./export-form-dialog";
import { ExportHistory } from "./export-history";

const DEFAULT_RETENTION_DAYS = 7;

/** Settings → Workspace → Exports: start an export, see and download files. */
export function ExportsPage() {
  const { t } = useTranslation();
  const { workspace, canManageWebhooks, isCheckingPermissions } =
    useWorkspacePermission();
  const { data: config } = useGetConfig();
  const [formOpen, setFormOpen] = useState(false);
  const retentionDays = config?.exportRetentionDays ?? DEFAULT_RETENTION_DAYS;
  const workspaceId = workspace?.id;

  return (
    <>
      <PageTitle title={t("settings:workspaceExports.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceExports.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceExports.subtitle", { days: retentionDays })}
          </p>
        </div>

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <FileDown className="size-4" />
                {t("settings:workspaceExports.history.title")}
              </CardTitle>
              <CardDescription>
                {t("settings:workspaceExports.history.description")}
              </CardDescription>
              <CardAction>
                <Button
                  onClick={() => setFormOpen(true)}
                  className="gap-2"
                  disabled={!workspaceId}
                >
                  <Plus className="size-4" />
                  {t("settings:workspaceExports.newExport")}
                </Button>
              </CardAction>
            </CardHeader>
          </Card>

          <Card className="!rounded-none">
            <CardPanel className="p-4">
              {workspaceId && (
                <ExportHistory
                  workspaceId={workspaceId}
                  canSeeAll={!isCheckingPermissions && canManageWebhooks()}
                  retentionDays={retentionDays}
                />
              )}
            </CardPanel>
          </Card>
        </CardFrame>
      </div>

      {workspaceId && (
        <ExportFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
}

export default ExportsPage;
