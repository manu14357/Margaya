import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import EstimateSettings from "@/components/estimate/estimate-settings";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { SettingsPage } from "@/components/settings-layout";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects/$projectId/estimates",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId } = Route.useParams();
  const { data: workspace } = useActiveWorkspace();

  return (
    <SettingsPage
      title={t("settings:projectEstimates.title")}
      documentTitle={t("settings:projectEstimates.pageTitle")}
      description={t("settings:projectEstimates.subtitle")}
    >
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspace?.id ?? ""}
        feature="estimates"
      >
        <EstimateSettings projectId={projectId} />
      </ProjectFeatureGate>
    </SettingsPage>
  );
}
