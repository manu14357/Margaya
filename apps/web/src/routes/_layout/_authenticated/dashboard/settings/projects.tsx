import {
  createFileRoute,
  Outlet,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { FolderKanban } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/projects",
)({
  // The navigation (with the project picker) lives in the settings frame.
  component: RouteComponent,
});

function isProjectsRoot(pathname: string) {
  return (
    pathname === "/dashboard/settings/projects" ||
    pathname === "/dashboard/settings/projects/"
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { data: workspace } = useActiveWorkspace();
  const { data: projects, isLoading } = useGetProjects({
    workspaceId: workspace?.id || "",
  });

  // The bare path opens the first project's General page.
  useEffect(() => {
    if (!isProjectsRoot(pathname) || !projects || projects.length === 0) {
      return;
    }

    void navigate({
      to: "/dashboard/settings/projects/$projectId/general",
      params: { projectId: projects[0].id },
      replace: true,
    });
  }, [pathname, navigate, projects]);

  if (!isProjectsRoot(pathname)) return <Outlet />;

  if (isLoading || !workspace || (projects && projects.length > 0)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-4 md:px-6 md:pt-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderKanban />
        </EmptyMedia>
        <EmptyTitle>{t("settings:projectSwitcher.noProjects")}</EmptyTitle>
        <EmptyDescription>{t("settings:nav.noProjectsHint")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
