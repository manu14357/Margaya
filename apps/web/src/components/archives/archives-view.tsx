import { useTranslation } from "react-i18next";
import { ViewTabs } from "@/components/common/view-tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useArchiveSummary } from "@/hooks/queries/archive/use-archive-summary";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import {
  ARCHIVED_TYPE_OF_TAB,
  type ArchiveTab,
  resolveArchiveTab,
  visibleArchiveTabs,
} from "@/lib/archives";
import ArchivedEntityList from "./archived-entity-list";
import ArchivedTasksTab from "./archived-tasks-tab";

const ALL_PROJECTS = "all";

type ArchivesViewProps = {
  workspaceId: string;
  /** Set on a project's Archives; absent for the workspace's. */
  projectId?: string;
  tab: ArchiveTab;
  /** Workspace scope: the project filter of Tasks, Cycles and Modules. */
  filterProjectId?: string;
  taskId?: string;
  onSearchChange: (patch: {
    tab?: ArchiveTab;
    projectId?: string;
    taskId?: string;
  }) => void;
};

function CountChip({ count }: { count: number | null | undefined }) {
  if (count === null || count === undefined) return null;
  return (
    <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-sm bg-muted px-1 font-medium text-[11px] text-muted-foreground tabular-nums">
      {count > 999 ? "999+" : count}
    </span>
  );
}

/**
 * The Archives screen in either scope: a tab per archived kind, with the
 * owner's restore and delete actions (B11 §1.5).
 */
export default function ArchivesView({
  workspaceId,
  projectId,
  tab,
  filterProjectId,
  taskId,
  onSearchChange,
}: ArchivesViewProps) {
  const { t } = useTranslation();
  const isProjectScope = Boolean(projectId);
  const { data: summary } = useArchiveSummary(workspaceId, projectId);
  const { data: projects } = useGetProjects({ workspaceId });
  const tabs = visibleArchiveTabs(
    summary,
    isProjectScope ? "project" : "workspace",
  );
  const active = resolveArchiveTab(tab, tabs);
  const scopedProjectId = projectId ?? filterProjectId;
  const showFilter = !isProjectScope && active !== "projects";
  const filterLabel =
    (filterProjectId &&
      projects?.find((project) => project.id === filterProjectId)?.name) ||
    t("workspace:archives.projectFilter.all");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewTabs
        label={t("workspace:archives.title")}
        value={active}
        tabs={tabs.map((key) => ({
          value: key,
          label: t(`workspace:archives.tabs.${key}`),
          badge: <CountChip count={summary?.[key]} />,
          onSelect: () =>
            onSearchChange({
              tab: key === "tasks" ? undefined : key,
              taskId: undefined,
            }),
        }))}
        trailing={
          showFilter ? (
            <Select
              value={filterProjectId ?? ALL_PROJECTS}
              onValueChange={(value) =>
                onSearchChange({
                  projectId:
                    !value || value === ALL_PROJECTS
                      ? undefined
                      : String(value),
                  taskId: undefined,
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="h-7.5 w-36 text-xs sm:w-44"
                aria-label={t("workspace:archives.projectFilter.all")}
              >
                <SelectValue>{filterLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS}>
                  {t("workspace:archives.projectFilter.all")}
                </SelectItem>
                {projects?.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />
      <p className="shrink-0 border-border/60 border-b px-3 py-1.5 text-muted-foreground text-xs md:px-4">
        {t("workspace:archives.subtitle")}
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        {active === "tasks" ? (
          <ArchivedTasksTab
            key={scopedProjectId ?? "workspace"}
            workspaceId={workspaceId}
            projectId={scopedProjectId}
            isProjectScope={isProjectScope}
            taskId={taskId}
          />
        ) : (
          <ArchivedEntityList
            key={`${active}:${scopedProjectId ?? "workspace"}`}
            workspaceId={workspaceId}
            projectId={scopedProjectId}
            type={ARCHIVED_TYPE_OF_TAB[active]}
            showProject={!isProjectScope}
          />
        )}
      </div>
    </div>
  );
}
