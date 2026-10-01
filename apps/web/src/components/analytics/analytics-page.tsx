import { type ReactNode, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import ProjectLayout from "@/components/common/project-layout";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { analyticsScopeKey } from "@/lib/analytics/scope-key";
import {
  type AnalyticsScopeKind,
  type AnalyticsTab,
  availableAnalyticsTabs,
  resolveAnalyticsTab,
} from "@/lib/analytics/tabs";
import {
  type AnalyticsScope,
  type AnalyticsScopeProject,
  AnalyticsScopeProvider,
} from "./analytics-context";
import AnalyticsProjectSelect from "./analytics-project-select";
import AnalyticsRefreshButton from "./analytics-refresh-button";
import {
  AnalyticsEmptyWorkspace,
  AnalyticsNoAccess,
  AnalyticsPageSkeleton,
} from "./analytics-states";
import AnalyticsTabs from "./analytics-tabs";
import CyclesTab from "./cycles-tab";
import IntakeTab from "./intake-tab";
import ModulesTab from "./modules-tab";
import OverviewTab from "./overview-tab";
import TasksTab from "./tasks-tab";

export type AnalyticsPageProps = {
  scope: AnalyticsScopeKind;
  workspaceId: string;
  /** Project scope: the project. */
  projectId?: string;
  /** The requested tab (from the URL); unavailable tabs fall back. */
  tab?: string;
  /** Workspace scope: the selected project ids (from the URL). */
  selectedProjectIds?: readonly string[];
  cycleId?: string;
  moduleId?: string;
  onTabChange: (tab: AnalyticsTab, options?: { replace?: boolean }) => void;
  onProjectsChange?: (ids: string[]) => void;
  onClearContext?: () => void;
};

type ListedProject = AnalyticsScopeProject & { archivedAt?: string | null };

const CONTENT_CLASS = "mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-5";

/**
 * Workspace and project analytics (B8 §1.2–1.7): one component, two scopes.
 * The header, tab strip and every section read the same scope.
 */
export default function AnalyticsPage({
  scope: kind,
  workspaceId,
  projectId,
  tab,
  selectedProjectIds = [],
  cycleId,
  moduleId,
  onTabChange,
  onProjectsChange,
  onClearContext,
}: AnalyticsPageProps) {
  const { t } = useTranslation();
  const {
    canReadAnalytics,
    canReadIntake,
    canCreateProjects,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const { data: workspace } = useActiveWorkspace();
  const { data: projectList, isLoading: isLoadingProjects } = useGetProjects({
    workspaceId,
  });

  const projects = useMemo(
    () =>
      ((projectList ?? []) as ListedProject[]).filter(
        (project) => !project.archivedAt,
      ),
    [projectList],
  );
  const project =
    kind === "project"
      ? ((projectList ?? []) as ListedProject[]).find(
          (entry) => entry.id === projectId,
        )
      : undefined;

  // Ids that are not (or no longer) workspace projects are dropped.
  const selection = useMemo(
    () =>
      kind === "workspace"
        ? selectedProjectIds.filter((id) =>
            projects.some((entry) => entry.id === id),
          )
        : [],
    [kind, selectedProjectIds, projects],
  );

  const scope = useMemo<AnalyticsScope>(() => {
    if (kind === "project") {
      const ids = projectId ? [projectId] : [];
      return {
        kind,
        workspaceId,
        projectId,
        projectIds: ids,
        scopeKey: analyticsScopeKey(ids),
        projects: project ? [project] : [],
        slug: project?.slug ?? "project",
      };
    }
    const projectIds = selection.length ? selection : undefined;
    return {
      kind,
      workspaceId,
      projectIds,
      scopeKey: analyticsScopeKey(projectIds),
      projects: projectIds
        ? projects.filter((entry) => projectIds.includes(entry.id))
        : projects,
      slug: workspace?.slug ?? "workspace",
    };
  }, [kind, workspaceId, projectId, project, selection, projects, workspace]);

  const isReady = !isCheckingPermissions && !isLoadingProjects;
  const canRead = canReadAnalytics();
  const tabs = availableAnalyticsTabs(kind, scope.projects, {
    canReadIntake: canReadIntake(),
  });
  const activeTab = resolveAnalyticsTab(tab, tabs, kind);

  // A deep link to a hidden or unknown tab is replaced by the default one.
  useEffect(() => {
    if (!isReady || !canRead || tab === undefined) return;
    if (tab !== activeTab) onTabChange(activeTab, { replace: true });
  }, [isReady, canRead, tab, activeTab, onTabChange]);

  const refresh = (
    <AnalyticsRefreshButton
      workspaceId={workspaceId}
      scopeKey={scope.scopeKey}
    />
  );
  const showControls = isReady && canRead;
  // The project filter is a lens on every report: it sits on the tab row.
  const projectFilter =
    kind === "workspace" && showControls && projects.length > 0 ? (
      <AnalyticsProjectSelect
        projects={projects}
        selected={selection}
        onChange={(ids) => onProjectsChange?.(ids)}
      />
    ) : null;

  let body: ReactNode;
  if (!isReady) {
    body = <AnalyticsPageSkeleton />;
  } else if (!canRead) {
    body = <AnalyticsNoAccess />;
  } else if (kind === "workspace" && projects.length === 0) {
    body = <AnalyticsEmptyWorkspace canCreate={canCreateProjects()} />;
  } else {
    body = (
      <AnalyticsScopeProvider value={scope}>
        <div className="flex h-full min-h-0 flex-col">
          <AnalyticsTabs
            tabs={tabs}
            active={activeTab}
            onSelect={(next) => onTabChange(next)}
            trailing={projectFilter}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            {activeTab === "tasks" ? (
              <TasksTab
                cycleId={kind === "project" ? cycleId : undefined}
                moduleId={kind === "project" ? moduleId : undefined}
                onClearContext={() => onClearContext?.()}
              />
            ) : (
              <div className={CONTENT_CLASS}>
                {activeTab === "overview" && <OverviewTab />}
                {activeTab === "cycles" && <CyclesTab />}
                {activeTab === "modules" && <ModulesTab />}
                {activeTab === "intake" && <IntakeTab />}
              </div>
            )}
          </div>
        </div>
      </AnalyticsScopeProvider>
    );
  }

  if (kind === "project" && projectId) {
    return (
      <>
        <PageTitle
          title={
            project
              ? t("analytics:projectPageTitle", { project: project.name })
              : t("analytics:pageTitle")
          }
        />
        <ProjectLayout
          projectId={projectId}
          workspaceId={workspaceId}
          activeSection="analytics"
          showViewSwitcher={false}
          headerActions={showControls ? refresh : null}
        >
          {body}
        </ProjectLayout>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t("analytics:pageTitle")} />
      <WorkspaceLayout
        title={t("analytics:pageTitle")}
        headerActions={showControls && projects.length > 0 ? refresh : null}
      >
        {body}
      </WorkspaceLayout>
    </>
  );
}
