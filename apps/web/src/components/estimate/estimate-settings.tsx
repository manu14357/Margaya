import { Plus, Ruler } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import EstimateCalibrationCard from "@/components/insight/estimate-calibration-card";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetEstimates } from "@/hooks/queries/estimate/use-get-estimates";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { Estimate } from "@/types/estimate";
import CreateEstimateDialog from "./create-estimate-dialog";
import DeleteEstimateDialog from "./delete-estimate-dialog";
import EstimateSystemCard from "./estimate-system-card";
import OtherEstimateSystems from "./other-estimate-systems";
import SwitchEstimateDialog from "./switch-estimate-dialog";

type EstimateSettingsProps = {
  projectId: string;
};

/**
 * Settings → Projects → Estimates, below the page header: the active
 * system, the systems used before, and the dialogs to create, switch and
 * delete them. Rendered only while the estimates feature is on. Editing
 * needs project:update, the same check the API makes.
 */
export default function EstimateSettings({ projectId }: EstimateSettingsProps) {
  const { t } = useTranslation();
  const { canUpdateProjects } = useWorkspacePermission();
  const canEdit = canUpdateProjects();
  const { data, isLoading, isError, refetch } = useGetEstimates(projectId);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [switchTargetId, setSwitchTargetId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-12 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          {t("settings:projectEstimates.loadError")}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("settings:projectEstimates.retry")}
        </Button>
      </div>
    );
  }

  const active =
    data.estimates.find((estimate) => estimate.id === data.activeEstimateId) ??
    null;
  const others = data.estimates.filter((estimate) => !estimate.isActive);
  // Looked up by id, so the dialogs follow refetches of the same system.
  const switchTarget =
    data.estimates.find((estimate) => estimate.id === switchTargetId) ?? null;
  const deleteTarget =
    data.estimates.find((estimate) => estimate.id === deleteTargetId) ?? null;

  const handleCreated = (created: Estimate) => {
    // With another system active, the new one waits to be switched to.
    if (!created.isActive) setSwitchTargetId(created.id);
  };

  return (
    <div className="space-y-8">
      {!canEdit && (
        <p className="text-muted-foreground text-sm">
          {t("settings:projectEstimates.readOnly")}
        </p>
      )}

      {data.estimates.length === 0 ? (
        <Empty className="rounded-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Ruler />
            </EmptyMedia>
            <EmptyTitle>
              {t("settings:projectEstimates.empty.title")}
            </EmptyTitle>
            <EmptyDescription>
              {t("settings:projectEstimates.empty.description")}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit && (
            <EmptyContent>
              <Button size="sm" onClick={() => setIsCreateOpen(true)}>
                <Plus />
                {t("settings:projectEstimates.empty.action")}
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-md font-medium">
                {active
                  ? t("settings:projectEstimates.activeTitle")
                  : t("settings:projectEstimates.noActiveTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {active
                  ? t("settings:projectEstimates.activeDescription")
                  : t("settings:projectEstimates.noActiveDescription")}
              </p>
            </div>
            {canEdit && !active && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus />
                {t("settings:projectEstimates.actions.newSystem")}
              </Button>
            )}
          </div>
          {active && (
            <EstimateSystemCard
              projectId={projectId}
              estimate={active}
              others={others}
              canEdit={canEdit}
              onNewSystem={() => setIsCreateOpen(true)}
              onSwitchTo={(estimate) => setSwitchTargetId(estimate.id)}
              onDelete={(estimate) => setDeleteTargetId(estimate.id)}
            />
          )}
          {active && <EstimateCalibrationCard projectId={projectId} />}
        </div>
      )}

      <OtherEstimateSystems
        estimates={others}
        canEdit={canEdit}
        onUse={(estimate) => setSwitchTargetId(estimate.id)}
        onDelete={(estimate) => setDeleteTargetId(estimate.id)}
      />

      <CreateEstimateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        projectId={projectId}
        existingNames={data.estimates.map((estimate) => estimate.name)}
        onCreated={handleCreated}
      />

      {switchTarget && (
        <SwitchEstimateDialog
          open
          onOpenChange={(open) => {
            if (!open) setSwitchTargetId(null);
          }}
          projectId={projectId}
          current={active}
          target={switchTarget}
        />
      )}

      {deleteTarget && (
        <DeleteEstimateDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTargetId(null);
          }}
          projectId={projectId}
          estimate={deleteTarget}
        />
      )}
    </div>
  );
}
