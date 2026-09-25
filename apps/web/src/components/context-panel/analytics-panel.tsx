import { useLocation, useNavigate } from "@tanstack/react-router";
import { ChartLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  PanelLink,
  PanelSection,
  ProjectTile,
} from "@/components/context-panel/panel-primitives";
import useGetProjects from "@/hooks/queries/project/use-get-projects";

/** Analytics: the workspace report, then each project's. */
export function AnalyticsPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { data: projects } = useGetProjects({ workspaceId });
  const base = `/dashboard/workspace/${workspaceId}`;

  return (
    <>
      <PanelSection>
        <PanelLink
          label={t("navigation:shell.workspaceAnalytics")}
          icon={ChartLine}
          active={pathname.startsWith(`${base}/analytics`)}
          onSelect={() => navigate({ to: `${base}/analytics` })}
        />
      </PanelSection>
      <PanelSection label={t("navigation:sidebar.projects")}>
        {(projects ?? []).map((project) => {
          const path = `${base}/project/${project.id}/analytics`;
          return (
            <PanelLink
              key={project.id}
              label={project.name}
              leading={<ProjectTile icon={project.icon} />}
              active={pathname === path}
              onSelect={() => navigate({ to: path })}
            />
          );
        })}
      </PanelSection>
    </>
  );
}
