import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import { ContextPanelSlot } from "@/components/context-panel/panel-slot";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { PageListTab } from "@/types/page";
import PageTreePanel from "./page-tree/page-tree-panel";
import PagesList from "./pages-list";

type PagesScreenProps = {
  workspaceId: string;
  projectId: string;
  tab: PageListTab;
  onTabChange: (tab: PageListTab) => void;
};

/**
 * The project's Pages section (§1.3): the list with its lens bar, and the
 * page tree in the shell's context panel.
 */
export default function PagesScreen({
  workspaceId,
  projectId,
  tab,
  onTabChange,
}: PagesScreenProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: project } = useGetProject({ id: projectId, workspaceId });
  const { canCreatePages, isCheckingPermissions } = useWorkspacePermission();
  const canCreate = !isCheckingPermissions && canCreatePages();
  const createPage = useCreatePage();

  // Untitled and at once; private when the Private tab is open.
  const handleCreate = () => {
    if (createPage.isPending) return;
    createPage.mutate(
      {
        projectId,
        access: tab === "private" ? "private" : "public",
      },
      {
        onSuccess: (page) =>
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
            params: { workspaceId, projectId, pageId: page.id },
          }),
        onError: (error) =>
          toast.error(pageErrorMessage(error) ?? t("pages:toasts.createError")),
      },
    );
  };

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeSection="pages"
      headerActions={
        canCreate ? (
          <Button
            size="xs"
            className="gap-1"
            loading={createPage.isPending}
            onClick={handleCreate}
          >
            <Plus className="size-3" />
            {t("pages:list.newPage")}
          </Button>
        ) : null
      }
    >
      <PageTitle
        title={t("pages:list.documentTitle", { project: project?.name ?? "" })}
        hideAppName
      />
      <ProjectFeatureGate
        projectId={projectId}
        workspaceId={workspaceId}
        feature="pages"
      >
        <ContextPanelSlot>
          <PageTreePanel
            workspaceId={workspaceId}
            projectId={projectId}
            userId={session?.user?.id}
          />
        </ContextPanelSlot>
        <PagesList
          workspaceId={workspaceId}
          projectId={projectId}
          tab={tab}
          onTabChange={onTabChange}
          onCreate={canCreate ? handleCreate : undefined}
          isCreating={createPage.isPending}
        />
      </ProjectFeatureGate>
    </ProjectLayout>
  );
}
