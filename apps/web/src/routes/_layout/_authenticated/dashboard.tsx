import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/common/app-shell";
import PageTitle from "@/components/page-title";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { usePendingCheckout } from "@/hooks/use-pending-checkout";
import { RouteProjectScope } from "@/hooks/use-project-scope";

export const Route = createFileRoute("/_layout/_authenticated/dashboard")({
  component: DashboardLayoutComponent,
});

// The app shell (rail, context panel, tab bar) is mounted here once, so it
// survives navigation between dashboard pages.
function DashboardLayoutComponent() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  usePendingCheckout();

  return (
    <>
      <PageTitle
        title={t("navigation:page.projectsTitle")}
        hideAppName={!workspace?.name}
      />
      <AppShell>
        {/* A project's pages act in that project; the shell around them
            stays about the workspace. */}
        <RouteProjectScope>
          <Outlet />
        </RouteProjectScope>
      </AppShell>
    </>
  );
}
