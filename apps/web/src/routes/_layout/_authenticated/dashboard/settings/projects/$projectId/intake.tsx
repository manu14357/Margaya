import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import EmailIntakeSettings from "@/components/intake-sources/email-intake-settings";
import RequestFormSettings from "@/components/intake-sources/request-form-settings";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import {
  SettingsPage,
  SettingsReadOnlyNotice,
} from "@/components/settings-layout";
import { Skeleton } from "@/components/ui/skeleton";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

// Intake sources (#8): email to intake and the public request form. Both
// open the queue to people outside the workspace, so they need project:share.
export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/intake",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();
  const { canShareProjects, isCheckingPermissions } = useWorkspacePermission();

  return (
    <SettingsPage
      title={t("settings:projectIntake.title")}
      documentTitle={t("settings:projectIntake.pageTitle")}
      description={t("settings:projectIntake.subtitle")}
    >
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspace?.id ?? ""}
        feature="intake"
      >
        {isCheckingPermissions ? (
          <Skeleton className="h-32 w-full" />
        ) : !canShareProjects() ? (
          <SettingsReadOnlyNotice>
            {t("settings:projectIntake.noPermission")}
          </SettingsReadOnlyNotice>
        ) : (
          <div className="space-y-8">
            <EmailIntakeSettings projectId={projectId} />
            <RequestFormSettings projectId={projectId} />
          </div>
        )}
      </ProjectFeatureGate>
    </SettingsPage>
  );
}
