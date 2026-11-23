import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AiSummaryButton } from "@/components/ai/ai-summary";
import ProjectArchivedNotice from "@/components/archives/project-archived-notice";
import ProjectCrumbSelect from "@/components/common/header/project-crumb-select";
import { TopBarRoomy } from "@/components/common/header/top-bar-label";
import Layout from "@/components/common/layout";
import {
  type ProjectLayoutView,
  ProjectViewTabs,
} from "@/components/common/project-view-tabs";
import { ProjectTile } from "@/components/context-panel/panel-primitives";
import ProjectFirstSteps from "@/components/create-project/project-first-steps";
import FavoriteButton from "@/components/favorite/favorite-button";
import ProjectLeadBadge from "@/components/project/project-lead-badge";
import ProjectPublicBadge from "@/components/publication/project-public-badge";
import CreateProjectModal from "@/components/shared/modals/create-project-modal";
import { ErrorDisplay } from "@/components/ui/error-display";
import {
  useRecordVisit,
  visitArchiveState,
} from "@/hooks/mutations/recent-visit/use-record-visit";
import useGetProject from "@/hooks/queries/project/use-get-project";
import { useWorkspaceProjectFeatures } from "@/hooks/use-project-features";
import { useProjectSections } from "@/hooks/use-project-sections";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";
import { HttpError } from "@/lib/http-error";
import {
  type ProjectSection,
  type ProjectSectionId,
  projectSectionPath,
} from "@/lib/project-sections";
import { useUserPreferencesStore } from "@/store/user-preferences";

type ProjectLayoutProps = {
  projectId: string;
  workspaceId: string;
  /** The top bar's primary-action slot. */
  headerActions?: ReactNode;
  children: ReactNode;
  /**
   * Whether a task layout tab is selected. Defaults to true in the Tasks
   * section; false leaves the tab row without a selection (project
   * archives).
   */
  showViewSwitcher?: boolean;
  activeView?: ProjectLayoutView;
  /** Defaults to the section the pathname belongs to. */
  activeSection?: ProjectSectionId;
  /** The place after the project, e.g. a cycle switcher ("· Sprint 4"). */
  extraCrumbs?: ReactNode;
  /** Right-aligned controls on the tab row (e.g. Display). */
  tabsTrailing?: ReactNode;
};

const LAYOUT_PATHS = {
  backlog: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
  board: "/dashboard/workspace/$workspaceId/project/$projectId/board",
  // Board and List are one page; the viewMode preference picks which it draws.
  list: "/dashboard/workspace/$workspaceId/project/$projectId/board",
  spreadsheet:
    "/dashboard/workspace/$workspaceId/project/$projectId/spreadsheet",
  calendar: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
  gantt: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
} as const satisfies Record<ProjectLayoutView, string>;

function viewFromPath(pathname: string): ProjectLayoutView {
  if (pathname.includes("/backlog")) return "backlog";
  if (pathname.includes("/spreadsheet")) return "spreadsheet";
  if (pathname.includes("/calendar")) return "calendar";
  if (pathname.includes("/gantt")) return "gantt";
  return "board";
}

function isInaccessible(error: unknown) {
  return (
    error instanceof HttpError && (error.status === 404 || error.status === 403)
  );
}

/**
 * A project page: the top bar (project tile and switcher, favorite, public
 * badge, the page's place), the project's tab row, then the body.
 */
export default function ProjectLayout({
  projectId,
  workspaceId,
  headerActions,
  children,
  showViewSwitcher,
  activeView,
  activeSection: activeSectionProp,
  extraCrumbs,
  tabsTrailing,
}: ProjectLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const setViewMode = useUserPreferencesStore((state) => state.setViewMode);
  const { data: project, error: projectError } = useGetProject({
    id: projectId,
    workspaceId,
  });
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] =
    useState(false);
  const { sections, activeSection } = useProjectSections({
    projectId,
    workspaceId,
    activeSection: activeSectionProp,
  });
  const isProjectFeatureEnabled = useWorkspaceProjectFeatures(workspaceId);
  const isTasksSection = activeSection === "tasks";
  const shouldShowViewSwitcher = showViewSwitcher ?? isTasksSection;

  useProjectWebSocket(projectId);
  useRecordVisit({
    workspaceId,
    entityType: "project",
    entityId: projectId,
    archived: visitArchiveState(project),
  });

  const resolvedView = activeView ?? viewFromPath(location.pathname);

  const goToView = (view: ProjectLayoutView, targetProjectId = projectId) => {
    navigate({
      to: LAYOUT_PATHS[view],
      params: { workspaceId, projectId: targetProjectId },
    });
  };

  const handleSelectView = (view: ProjectLayoutView) => {
    if (view === "board" || view === "list") setViewMode(view);
    goToView(view);
  };

  const handleSelectSection = (section: ProjectSection) => {
    if (section.id === "tasks") {
      goToView("board");
      return;
    }
    navigate({ to: projectSectionPath(section, workspaceId, projectId) });
  };

  const handleProjectSwitch = (nextProjectId: string) => {
    // Outside Tasks, stay in the same section when the target project has
    // it; otherwise land on the target's board.
    if (!isTasksSection) {
      const section = sections.find(
        (candidate) => candidate.id === activeSection,
      );
      // A section without a feature (Analytics) exists in every project.
      const keepSection = section?.feature
        ? isProjectFeatureEnabled(nextProjectId, section.feature)
        : Boolean(section);
      if (section && keepSection) {
        navigate({
          to: projectSectionPath(section, workspaceId, nextProjectId),
        });
      } else {
        goToView("board", nextProjectId);
      }
      return;
    }

    goToView(resolvedView, nextProjectId);
  };

  // A project the caller can't see (another workspace's, a restricted one,
  // or a guest's link to a project she isn't in) answers 404 or 403. Show
  // only the not-found page, without this project's switcher and tabs.
  if (!project && isInaccessible(projectError)) {
    return (
      <Layout>
        <Layout.TopBar />
        <Layout.Content>
          <ErrorDisplay error={projectError} />
        </Layout.Content>
      </Layout>
    );
  }

  return (
    <Layout>
      <Layout.TopBar
        place={
          <>
            <TopBarRoomy hideWhen="tight">
              <ProjectTile
                icon={project?.icon}
                seed={project?.id}
                className="size-6"
              />
            </TopBarRoomy>
            <ProjectCrumbSelect
              workspaceId={workspaceId}
              projectId={projectId}
              projectName={project?.name}
              onSelectProject={handleProjectSwitch}
              onAddProject={() => setIsCreateProjectModalOpen(true)}
              // With a place after it (a cycle, a page) a long project name
              // leaves that place room instead of pushing it out of the bar.
              className={extraCrumbs ? "xl:max-w-64" : undefined}
            />
            {project && (
              <TopBarRoomy>
                <span className="hidden items-center gap-1 sm:flex">
                  <FavoriteButton
                    workspaceId={workspaceId}
                    entityType="project"
                    entityId={projectId}
                    placeholder={{
                      name: project.name,
                      icon: project.icon,
                      key: project.slug,
                    }}
                  />
                  <ProjectPublicBadge
                    projectId={projectId}
                    isPublic={Boolean(project.isPublic)}
                  />
                  <ProjectLeadBadge
                    workspaceId={workspaceId}
                    leadUserId={project.leadUserId}
                  />
                  {isTasksSection && (
                    <AiSummaryButton
                      kind="project"
                      id={projectId}
                      projectId={projectId}
                      workspaceId={workspaceId}
                      name={project.name}
                    />
                  )}
                </span>
              </TopBarRoomy>
            )}
            {/* Below xl the top bar has no room for them beside the actions. */}
            {/* The crumbs' switchers shrink and truncate with an ellipsis
                (buttons do not shrink by default), never cut off mid-word; the
                section links before them keep their size. */}
            {extraCrumbs && (
              <span className="hidden min-w-0 items-center gap-1 xl:flex [&_a]:shrink-0 [&_button]:min-w-0 [&_button]:shrink">
                <span aria-hidden className="text-muted-foreground/60">
                  ·
                </span>
                {extraCrumbs}
              </span>
            )}
          </>
        }
        actions={headerActions}
      />

      <ProjectViewTabs
        projectId={projectId}
        workspaceId={workspaceId}
        sections={sections}
        activeSection={activeSection}
        activeView={shouldShowViewSwitcher ? resolvedView : null}
        onSelectView={handleSelectView}
        onSelectSection={handleSelectSection}
        trailing={tabsTrailing}
      />

      <ProjectArchivedNotice project={project} />
      {isTasksSection && <ProjectFirstSteps project={project} />}

      <Layout.Content>{children}</Layout.Content>

      <CreateProjectModal
        open={isCreateProjectModalOpen}
        onClose={() => setIsCreateProjectModalOpen(false)}
      />
    </Layout>
  );
}
