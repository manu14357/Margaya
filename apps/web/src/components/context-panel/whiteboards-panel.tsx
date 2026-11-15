import { useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PanelHint,
  PanelLink,
  PanelSection,
  ProjectTile,
} from "@/components/context-panel/panel-primitives";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import { projectsWithWhiteboards } from "@/lib/whiteboards/workspace-whiteboards";

/** Whiteboards: every board in the workspace, then each project's. */
export function WhiteboardsPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: projects, isSuccess } = useGetProjects({ workspaceId });
  const withBoards = projectsWithWhiteboards(projects);
  const base = `/dashboard/workspace/${workspaceId}`;
  const all = `${base}/whiteboards`;

  return (
    <>
      <PanelSection>
        <PanelLink
          label={t("navigation:shell.allWhiteboards")}
          icon={LayoutGrid}
          active={pathname === all || pathname === `${all}/`}
          onSelect={() => navigate({ to: all })}
        />
      </PanelSection>
      <PanelSection label={t("navigation:sidebar.projects")}>
        {isSuccess && withBoards.length === 0 && (
          <PanelHint>{t("navigation:shell.noWhiteboardsProjects")}</PanelHint>
        )}
        {withBoards.map((project) => {
          const path = `${base}/project/${project.id}/whiteboards`;
          return (
            <PanelLink
              key={project.id}
              label={project.name}
              leading={<ProjectTile icon={project.icon} seed={project.id} />}
              active={pathname === path || pathname.startsWith(`${path}/`)}
              onSelect={() => navigate({ to: path })}
            />
          );
        })}
      </PanelSection>
    </>
  );
}
