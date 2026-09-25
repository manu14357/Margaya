import { useLocation, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  PanelHint,
  PanelLink,
  PanelSection,
  ProjectTile,
} from "@/components/context-panel/panel-primitives";
import { isProjectFeatureEnabled } from "@/constants/project-features";
import useGetProjects from "@/hooks/queries/project/use-get-projects";

/** Pages live in projects: every project with Pages turned on. */
export function PagesPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: projects, isSuccess } = useGetProjects({ workspaceId });
  const withPages = (projects ?? []).filter((project) =>
    isProjectFeatureEnabled(project, "pages"),
  );

  return (
    <PanelSection label={t("navigation:sidebar.projects")}>
      {isSuccess && withPages.length === 0 && (
        <PanelHint>{t("navigation:shell.noPagesProjects")}</PanelHint>
      )}
      {withPages.map((project) => {
        const path = `/dashboard/workspace/${workspaceId}/project/${project.id}/pages`;
        return (
          <PanelLink
            key={project.id}
            label={project.name}
            leading={<ProjectTile icon={project.icon} />}
            active={pathname === path || pathname.startsWith(`${path}/`)}
            onSelect={() => navigate({ to: path })}
          />
        );
      })}
    </PanelSection>
  );
}
