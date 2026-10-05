import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { addMonths, addWeeks, startOfMonth } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CalendarToolbar from "@/components/calendar/calendar-toolbar";
import MonthGrid from "@/components/calendar/month-grid";
import {
  buildMonthWeeks,
  buildWeekDays,
} from "@/components/calendar/month-grid-model";
import ProjectLayout from "@/components/common/project-layout";
import PageTitle from "@/components/page-title";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import ProjectFilterBar from "@/components/task-filters/project-filter-bar";
import { shortcuts } from "@/constants/shortcuts";
import { useUpdateTaskDates } from "@/hooks/mutations/task/use-update-task-dates";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useProjectLayoutFilter } from "@/hooks/use-project-layout-filter";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { rescheduleTaskDates } from "@/lib/schedule-dates";
import { toScheduledTasks } from "@/lib/task-schedule";
import { toast } from "@/lib/toast";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import { useUserPreferencesStore } from "@/store/user-preferences";

type CalendarSearchParams = {
  taskId?: string;
};

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/calendar",
)({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): CalendarSearchParams => ({
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
});

// Lanes are capped so a busy week cannot push a row taller than the viewport;
// anything past the cap surfaces as a per-day overflow hint.
const MAX_LANES_DESKTOP = 3;
const MAX_LANES_MOBILE = 2;
// The week view has one row, so each day has room for many more lanes.
const WEEK_LANES_DESKTOP = 10;
const WEEK_LANES_MOBILE = 6;

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const { taskId } = Route.useSearch();
  const navigate = useNavigate();
  const { data: loadedProject, isLoading, isError } = useGetTasks(projectId);
  const {
    queryState,
    filteredProject: project,
    status: filterStatus,
  } = useProjectLayoutFilter({
    workspaceId,
    projectId,
    project: loadedProject,
  });
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const setViewMode = useUserPreferencesStore((state) => state.setViewMode);
  const isMobile = useIsMobile();
  const mode = useScheduleViewPreferences((state) => state.calendarMode);
  const setMode = useScheduleViewPreferences((state) => state.setCalendarMode);
  const showWeekends = useScheduleViewPreferences(
    (state) => state.calendarShowWeekends,
  );
  const setShowWeekends = useScheduleViewPreferences(
    (state) => state.setCalendarShowWeekends,
  );
  const { canUpdateTasks, canCreateTasks } = useWorkspacePermission();
  const canEditDates = Boolean(canUpdateTasks());
  const canCreate = Boolean(canCreateTasks());
  const { mutate: updateTaskDates } = useUpdateTaskDates();
  // Any day of the visible period: the month or week that contains it shows.
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [createDay, setCreateDay] = useState<Date | null>(null);
  const isWeek = mode === "week";
  const visibleMonth = startOfMonth(anchorDate);

  const scheduledTasks = useMemo(() => toScheduledTasks(project), [project]);

  const weeks = useMemo(
    () =>
      isWeek
        ? [buildWeekDays(anchorDate, weekStartsOn)]
        : buildMonthWeeks(anchorDate, weekStartsOn),
    [anchorDate, isWeek, weekStartsOn],
  );

  const handlePrevious = useCallback(() => {
    setAnchorDate((current) =>
      isWeek ? addWeeks(current, -1) : startOfMonth(addMonths(current, -1)),
    );
  }, [isWeek]);

  const handleNext = useCallback(() => {
    setAnchorDate((current) =>
      isWeek ? addWeeks(current, 1) : startOfMonth(addMonths(current, 1)),
    );
  }, [isWeek]);

  const handleToday = useCallback(() => {
    setAnchorDate(new Date());
  }, []);

  const handleReschedule = useCallback(
    (movedTaskId: string, grabbedDay: Date, dropDay: Date) => {
      const task = [
        ...(project?.columns.flatMap((column) => column.tasks) ?? []),
        ...(project?.plannedTasks ?? []),
      ].find((candidate) => candidate.id === movedTaskId);
      if (!task) return;
      updateTaskDates(
        { task, ...rescheduleTaskDates(task, grabbedDay, dropDay) },
        {
          onError: (error) =>
            toast.error(error.message || t("tasks:calendar.rescheduleError")),
        },
      );
    },
    [project, updateTaskDates, t],
  );

  const handleOpenTask = useCallback(
    (nextTaskId: string) => {
      navigate({ to: ".", search: { taskId: nextTaskId }, replace: true });
    },
    [navigate],
  );

  const handleCloseTaskSheet = useCallback(() => {
    navigate({ to: ".", search: {}, replace: true });
  }, [navigate]);

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.view.prefix]: {
        [shortcuts.view.board]: () => {
          setViewMode("board");
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.list]: () => {
          setViewMode("list");
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/board",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.backlog]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/backlog",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.gantt]: () => {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/gantt",
            params: { workspaceId, projectId },
          });
        },
        [shortcuts.view.calendar]: () => {},
      },
    },
  });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="calendar"
    >
      <PageTitle
        title={t("tasks:calendar.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="flex h-full min-h-0 flex-col bg-background">
        <ProjectFilterBar
          workspaceId={workspaceId}
          projectId={projectId}
          handle={queryState}
          status={filterStatus}
          trailing={
            <CalendarToolbar
              visibleDate={
                isWeek ? (weeks[0]?.[0] ?? anchorDate) : visibleMonth
              }
              visibleEnd={isWeek ? weeks[0]?.[6] : undefined}
              mode={mode}
              onModeChange={setMode}
              showWeekends={showWeekends}
              onShowWeekendsChange={setShowWeekends}
              onPrevious={handlePrevious}
              onNext={handleNext}
              onToday={handleToday}
            />
          }
        />

        {isLoading ? (
          <div className="border-border/80 border-b px-4 py-2 text-center">
            <p className="text-muted-foreground text-xs">
              {t("common:empty.loading")}
            </p>
          </div>
        ) : isError ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-destructive">
              {t("tasks:calendar.loadError")}
            </p>
          </div>
        ) : scheduledTasks.length === 0 ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-foreground">
              {t("tasks:calendar.noTasks")}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("tasks:calendar.noTasksSubtitle")}
            </p>
          </div>
        ) : null}

        <MonthGrid
          weeks={weeks}
          tasks={scheduledTasks}
          visibleMonth={isWeek ? undefined : visibleMonth}
          maxLanes={
            isWeek
              ? isMobile
                ? WEEK_LANES_MOBILE
                : WEEK_LANES_DESKTOP
              : isMobile
                ? MAX_LANES_MOBILE
                : MAX_LANES_DESKTOP
          }
          projectSlug={project?.slug}
          onOpenTask={handleOpenTask}
          showWeekends={showWeekends}
          canEditDates={canEditDates}
          onReschedule={handleReschedule}
          onCreateTask={canCreate ? setCreateDay : undefined}
        />

        <CreateTaskModal
          open={createDay !== null}
          onClose={() => setCreateDay(null)}
          projectId={projectId}
          prefill={createDay ? { dueDate: createDay } : undefined}
        />

        <TaskDetailsSheet
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
          onClose={handleCloseTaskSheet}
        />
      </div>
    </ProjectLayout>
  );
}
