import { addMonths, addWeeks, startOfMonth } from "date-fns";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CalendarToolbar from "@/components/calendar/calendar-toolbar";
import DayCapturePopover, {
  type DayCaptureTarget,
} from "@/components/calendar/day-capture-popover";
import MonthGrid from "@/components/calendar/month-grid";
import {
  buildMonthWeeks,
  buildWeekDays,
} from "@/components/calendar/month-grid-model";
import { buildStatusTones } from "@/components/calendar/status-tone";
import CreateTaskModal, {
  type CreateTaskPrefill,
} from "@/components/shared/modals/create-task-modal";
import { useUpdateTaskDates } from "@/hooks/mutations/task/use-update-task-dates";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getEntryColumn, withoutTriage } from "@/lib/column-groups";
import { rescheduleTaskDates } from "@/lib/schedule-dates";
import { toScheduledTasks } from "@/lib/task-schedule";
import { toast } from "@/lib/toast";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";

// Lanes are capped so a busy week cannot push a row taller than the viewport;
// anything past the cap surfaces as a per-day overflow hint.
const MAX_LANES_DESKTOP = 3;
const MAX_LANES_MOBILE = 2;
// The week view has one row, so each day has room for many more lanes.
const WEEK_LANES_DESKTOP = 10;
const WEEK_LANES_MOBILE = 6;

type ProjectCalendarProps = {
  workspaceId: string;
  projectId: string;
  /** The project as loaded, for colours and the entry column. */
  loadedProject: ProjectWithTasks | undefined;
  /** The project narrowed by the page's filters. */
  project: ProjectWithTasks | null;
  isLoading: boolean;
  isError: boolean;
  /** Places the calendar's own toolbar (period, mode) in the page's bar. */
  renderToolbar: (calendarToolbar: ReactNode) => ReactNode;
  onOpenTask: (taskId: string) => void;
};

/**
 * A project's dated tasks on a month or week grid, with drag to reschedule
 * and a quick add on each day. The project page and project-scoped saved
 * views both draw it; each owns its data, filters and task sheet.
 */
export default function ProjectCalendar({
  workspaceId,
  projectId,
  loadedProject,
  project,
  isLoading,
  isError,
  renderToolbar,
  onOpenTask,
}: ProjectCalendarProps) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
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
  const [captureTarget, setCaptureTarget] = useState<DayCaptureTarget | null>(
    null,
  );
  const [composer, setComposer] = useState<{
    status?: string;
    prefill: CreateTaskPrefill;
  } | null>(null);
  // New tasks land in the project's entry column, as on the board.
  const entryColumn =
    getEntryColumn(loadedProject?.columns ?? []) ??
    withoutTriage(loadedProject?.columns ?? [])[0];
  const handleCreateTask = useCallback(
    (day: Date, anchor: HTMLElement) => {
      if (entryColumn) setCaptureTarget({ day, anchor });
      else setComposer({ prefill: { dueDate: day } });
    },
    [entryColumn],
  );
  const isWeek = mode === "week";
  const visibleMonth = startOfMonth(anchorDate);

  const scheduledTasks = useMemo(() => toScheduledTasks(project), [project]);
  const tones = useMemo(
    () => buildStatusTones(loadedProject?.columns),
    [loadedProject?.columns],
  );

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

  const calendarToolbar = (
    <CalendarToolbar
      visibleDate={isWeek ? (weeks[0]?.[0] ?? anchorDate) : visibleMonth}
      visibleEnd={isWeek ? weeks[0]?.[6] : undefined}
      mode={mode}
      onModeChange={setMode}
      showWeekends={showWeekends}
      onShowWeekendsChange={setShowWeekends}
      onPrevious={handlePrevious}
      onNext={handleNext}
      onToday={handleToday}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {renderToolbar(calendarToolbar)}

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
        onOpenTask={onOpenTask}
        showWeekends={showWeekends}
        canEditDates={canEditDates}
        onReschedule={handleReschedule}
        onCreateTask={canCreate ? handleCreateTask : undefined}
        tones={tones}
      />

      {entryColumn ? (
        <DayCapturePopover
          projectId={projectId}
          workspaceId={workspaceId}
          target={captureTarget}
          column={entryColumn}
          onClose={() => setCaptureTarget(null)}
          onOpenComposer={setComposer}
        />
      ) : null}

      <CreateTaskModal
        open={composer !== null}
        onClose={() => setComposer(null)}
        projectId={projectId}
        status={composer?.status}
        prefill={composer?.prefill}
      />
    </div>
  );
}
