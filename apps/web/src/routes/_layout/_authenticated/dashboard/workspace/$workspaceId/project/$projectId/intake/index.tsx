import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import CreateIntakeDialog from "@/components/intake/create-intake-dialog";
import IntakeScreen from "@/components/intake/intake-screen";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useProjectFeatures } from "@/hooks/use-project-features";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { tabOfStatus } from "@/lib/intake";
import { type IntakeSearch, validateIntakeSearch } from "@/lib/intake-search";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/intake/",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): IntakeSearch =>
    validateIntakeSearch(search),
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canCreateIntake, isCheckingPermissions } = useWorkspacePermission();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { isEnabled } = useProjectFeatures({ projectId, workspaceId });
  const canCreate =
    !isCheckingPermissions && canCreateIntake() && isEnabled("intake");

  // Filters and the selection replace the history entry, so Back leaves
  // the section instead of stepping through every click.
  const handleSearchChange = useCallback(
    (patch: Partial<IntakeSearch>) =>
      navigate({
        search: (previous: IntakeSearch) => ({ ...previous, ...patch }),
        replace: true,
      }),
    [navigate],
  );

  const headerActions = canCreate ? (
    <Button
      variant="outline"
      size="xs"
      className="gap-1"
      onClick={() => setIsCreateOpen(true)}
    >
      <Plus className="size-3" />
      {t("intake:newRequest")}
    </Button>
  ) : null;

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="intake"
      showViewSwitcher={false}
      headerActions={headerActions}
    >
      <PageTitle
        title={t("intake:pageTitle", { project: project?.name ?? "" })}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="intake"
      >
        <IntakeScreen
          projectId={projectId}
          workspaceId={workspaceId}
          search={search}
          onSearchChange={handleSearchChange}
          onCreate={canCreate ? () => setIsCreateOpen(true) : undefined}
        />
        {canCreate && (
          <CreateIntakeDialog
            open={isCreateOpen}
            onOpenChange={setIsCreateOpen}
            projectId={projectId}
            onView={(item) =>
              handleSearchChange({
                tab:
                  tabOfStatus(item.status) === "closed" ? "closed" : undefined,
                status: undefined,
                item: item.id,
              })
            }
          />
        )}
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
