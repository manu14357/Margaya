import { useLocation, useNavigate } from "@tanstack/react-router";
import { Archive, Layers, Rows3, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PanelLink,
  PanelSection,
} from "@/components/context-panel/panel-primitives";
import { NavFavorites } from "@/components/favorite/nav-favorites";
import { NavProjects } from "@/components/nav-projects";

/**
 * Projects: a filter, the workspace task lists, Favorites, then every
 * project with its enabled sections.
 */
export function ProjectsPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const [filter, setFilter] = useState("");
  const base = `/dashboard/workspace/${workspaceId}`;

  return (
    <>
      <div className="px-3 pt-1 pb-1.5">
        <label className="flex h-7.5 items-center gap-2 rounded-md border border-input bg-background px-2 text-[13px] focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24">
          <Search
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="sr-only">
            {t("navigation:shell.filterProjects")}
          </span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("navigation:shell.filterProjects")}
            className="min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-muted-foreground/72"
          />
        </label>
      </div>

      {!filter && (
        <PanelSection>
          <PanelLink
            label={t("navigation:sidebar.allTasks")}
            icon={Rows3}
            active={pathname === `${base}/views/all`}
            onSelect={() => navigate({ to: `${base}/views/all` })}
          />
          <PanelLink
            label={t("views:nav.title")}
            icon={Layers}
            active={
              pathname.startsWith(`${base}/views`) &&
              pathname !== `${base}/views/all`
            }
            onSelect={() => navigate({ to: `${base}/views` })}
          />
          <PanelLink
            label={t("navigation:projectList.archives")}
            icon={Archive}
            active={pathname.startsWith(`${base}/archives`)}
            onSelect={() => navigate({ to: `${base}/archives` })}
          />
        </PanelSection>
      )}

      {!filter && <NavFavorites />}
      <NavProjects filter={filter} />
    </>
  );
}
