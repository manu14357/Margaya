import { LayoutDashboard, SlidersHorizontal } from "lucide-react";
import { type ComponentType, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/components/common/layout";
import HomeRisksWidget from "@/components/delivery/home-risks-widget";
import MyBriefWidget from "@/components/insight/my-brief-widget";
import PageTitle from "@/components/page-title";
import QuickLinksWidget from "@/components/quick-link/quick-links-widget";
import StickiesWidget from "@/components/sticky/stickies-widget";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import useGetHomePreferences from "@/hooks/queries/home/use-get-home-preferences";
import GetStarted from "./get-started";
import HomeFocus from "./home-focus";
import HomeGreeting from "./home-greeting";
import {
  DEFAULT_HOME_WIDGETS,
  type HomeWidgetKey,
  normalizeHomeWidgets,
} from "./home-widgets";
import ManageWidgetsDialog from "./manage-widgets-dialog";
import RecentsWidget from "./recents-widget";

type WidgetProps = {
  workspaceId: string;
  onOpenTask: (taskId: string, projectId: string) => void;
};

const WIDGET_COMPONENTS: Record<HomeWidgetKey, ComponentType<WidgetProps>> = {
  "quick-links": QuickLinksWidget,
  recents: RecentsWidget,
  stickies: StickiesWidget,
  risks: HomeRisksWidget,
  "my-brief": MyBriefWidget,
};

function WidgetsSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

type HomePageProps = {
  workspaceId: string;
  taskId?: string;
  projectId?: string;
  onOpenTask: (taskId: string, projectId: string) => void;
  onCloseTask: () => void;
};

/**
 * The workspace landing page, a focused dashboard: the greeting, a strip
 * that jumps to the inbox, your work and stickies, first steps, then the
 * personal widgets in their saved order.
 */
export default function HomePage({
  workspaceId,
  taskId,
  projectId,
  onOpenTask,
  onCloseTask,
}: HomePageProps) {
  const { t } = useTranslation();
  const [manageOpen, setManageOpen] = useState(false);
  const { data: preferences, isLoading } = useGetHomePreferences({
    workspaceId,
  });

  // A failed load falls back to the defaults; saving reports its own error.
  const widgets = preferences
    ? normalizeHomeWidgets(preferences.widgets)
    : [...DEFAULT_HOME_WIDGETS];
  const enabled = widgets.filter((widget) => widget.enabled);

  const manageLabel = t("home:manageWidgets");

  // The sheet keeps its project while it animates closed.
  const lastProjectId = useRef(projectId);
  if (projectId) lastProjectId.current = projectId;
  const sheetProjectId = projectId ?? lastProjectId.current;

  return (
    <>
      <PageTitle title={t("home:pageTitle")} />
      <Layout>
        <Layout.TopBar
          title={t("home:pageTitle")}
          actions={
            <Button
              variant="outline"
              size="xs"
              className="gap-1"
              onClick={() => setManageOpen(true)}
              aria-label={manageLabel}
              title={manageLabel}
            >
              <SlidersHorizontal className="size-3" />
              <span className="hidden sm:inline">{manageLabel}</span>
            </Button>
          }
        />
        <Layout.ContentArea width="wide" className="space-y-6 md:py-6">
          <HomeGreeting />
          <HomeFocus workspaceId={workspaceId} />
          <GetStarted workspaceId={workspaceId} />
          {isLoading ? (
            <WidgetsSkeleton />
          ) : enabled.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayoutDashboard />
                </EmptyMedia>
                <EmptyTitle>{t("home:empty.title")}</EmptyTitle>
                <EmptyDescription>
                  {t("home:empty.description")}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setManageOpen(true)}>
                  {manageLabel}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            enabled.map(({ key }) => {
              const Widget = WIDGET_COMPONENTS[key];
              return (
                <Widget
                  key={key}
                  workspaceId={workspaceId}
                  onOpenTask={onOpenTask}
                />
              );
            })
          )}
        </Layout.ContentArea>
      </Layout>

      <ManageWidgetsDialog
        workspaceId={workspaceId}
        widgets={widgets}
        isLoading={isLoading}
        open={manageOpen}
        onOpenChange={setManageOpen}
      />
      {sheetProjectId && (
        <TaskDetailsSheet
          taskId={taskId && projectId ? taskId : undefined}
          projectId={sheetProjectId}
          workspaceId={workspaceId}
          onClose={onCloseTask}
        />
      )}
    </>
  );
}
