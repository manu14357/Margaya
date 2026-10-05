import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsGroup,
  SettingsPage,
  SettingsSection,
} from "@/components/settings-layout";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getAvailableProjectFeatures,
  getProjectFeature,
  type ProjectFeatureKey,
} from "@/constants/project-features";
import useUpdateProjectFeatures from "@/hooks/mutations/project/use-update-project-features";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/features",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id ?? "";
  const { project, isLoading, isError, refetch } = useProjectFeatures({
    projectId,
    workspaceId,
  });
  const { mutateAsync: updateFeatures } = useUpdateProjectFeatures();
  const { canUpdateProjects } = useWorkspacePermission();
  const canEdit = canUpdateProjects();
  const [pendingDisable, setPendingDisable] =
    useState<ProjectFeatureKey | null>(null);

  const features = getAvailableProjectFeatures();

  const saveFeature = async (key: ProjectFeatureKey, enabled: boolean) => {
    const feature = getProjectFeature(key);
    const title = t(feature.titleKey);
    try {
      await updateFeatures({
        projectId,
        workspaceId,
        features: { [feature.field]: enabled },
      });
      toast.success(
        enabled
          ? t("settings:projectFeatures.toastEnabled", { feature: title })
          : t("settings:projectFeatures.toastDisabled", { feature: title }),
      );
    } catch {
      toast.error(t("settings:projectFeatures.toastError"));
    }
  };

  const handleToggle = (key: ProjectFeatureKey, enabled: boolean) => {
    if (enabled) {
      void saveFeature(key, true);
    } else {
      setPendingDisable(key);
    }
  };

  const pendingTitle = pendingDisable
    ? t(getProjectFeature(pendingDisable).titleKey)
    : "";

  return (
    <SettingsPage
      title={t("settings:projectFeatures.title")}
      documentTitle={t("settings:projectFeatures.pageTitle")}
      description={t("settings:projectFeatures.subtitle")}
    >
      <SettingsSection
        title={t("settings:projectFeatures.sectionTitle")}
        description={t("settings:projectFeatures.sectionSubtitle")}
      >
        {isLoading || !workspaceId ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError || !project ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{t("settings:projectFeatures.loadError")}</span>
            <Button variant="outline" size="xs" onClick={() => refetch()}>
              {t("settings:projectFeatures.retry")}
            </Button>
          </div>
        ) : (
          <>
            <SettingsGroup>
              {features.map((feature) => {
                const Icon = feature.icon;
                const switchId = `project-feature-${feature.key}`;
                return (
                  <div
                    key={feature.key}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
                        <Icon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <Label
                          htmlFor={switchId}
                          className="text-sm font-medium"
                        >
                          {t(feature.titleKey)}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {t(feature.descriptionKey)}
                        </p>
                      </div>
                    </div>
                    <Switch
                      id={switchId}
                      checked={project[feature.field] === true}
                      onCheckedChange={
                        canEdit
                          ? (checked) => handleToggle(feature.key, checked)
                          : undefined
                      }
                      disabled={!canEdit}
                    />
                  </div>
                );
              })}
            </SettingsGroup>
            {!canEdit && (
              <p className="text-xs text-muted-foreground">
                {t("settings:projectFeatures.noPermission")}
              </p>
            )}
          </>
        )}
      </SettingsSection>

      <AlertDialog
        open={pendingDisable !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisable(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:projectFeatures.disableConfirmTitle", {
                feature: pendingTitle,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:projectFeatures.disableConfirmDescription", {
                feature: pendingTitle,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (pendingDisable) void saveFeature(pendingDisable, false);
                  }}
                />
              }
            >
              {t("settings:projectFeatures.disableConfirmAction")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
