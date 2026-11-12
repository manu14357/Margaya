import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, LayoutTemplate, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TopBarLabel } from "@/components/common/header/top-bar-label";
import ProjectLayout from "@/components/common/project-layout";
import { ContextPanelSlot } from "@/components/context-panel/panel-slot";
import PageTitle from "@/components/page-title";
import ProjectFeatureGate from "@/components/project/project-feature-gate";
import { Button } from "@/components/ui/button";
import { Group, GroupSeparator } from "@/components/ui/group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useCreatePage } from "@/hooks/mutations/page/use-create-page";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { pageErrorMessage } from "@/lib/pages/page-errors";
import { toast } from "@/lib/toast";
import type { PageListTab } from "@/types/page";
import NewPageFromTemplateDialog, {
  type TemplateChoice,
} from "./new-page-from-template-dialog";
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
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Untitled and at once; private when the Private tab is open. From a
  // template, the page starts with its content (and a saved one's title).
  const handleCreate = (template?: TemplateChoice) => {
    if (createPage.isPending) return;
    const fromTemplate =
      template?.kind === "builtin"
        ? { title: template.title, content: template.content }
        : template?.kind === "saved"
          ? { templateId: template.templateId }
          : {};
    createPage.mutate(
      {
        projectId,
        access: tab === "private" ? "private" : "public",
        ...fromTemplate,
      },
      {
        onSuccess: (page) => {
          setTemplatesOpen(false);
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/pages/$pageId",
            params: { workspaceId, projectId, pageId: page.id },
          });
        },
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
          <Group aria-label={t("pages:list.newPage")}>
            <Button
              size="xs"
              className="gap-1"
              loading={createPage.isPending && !templatesOpen}
              onClick={() => handleCreate()}
            >
              <Plus className="size-3" />
              <TopBarLabel>{t("pages:list.newPage")}</TopBarLabel>
            </Button>
            <GroupSeparator />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-xs"
                    aria-label={t("pages:templates.moreCreateOptions")}
                  />
                }
              >
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTemplatesOpen(true)}>
                  <LayoutTemplate />
                  {t("pages:templates.newFromTemplate")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Group>
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
          onCreate={canCreate ? () => handleCreate() : undefined}
          isCreating={createPage.isPending}
        />
      </ProjectFeatureGate>
      {canCreate && (
        <NewPageFromTemplateDialog
          projectId={projectId}
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          onChoose={handleCreate}
          isCreating={createPage.isPending}
        />
      )}
    </ProjectLayout>
  );
}
