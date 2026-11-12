import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { addDays, format, isSameMonth, isToday, isWeekend } from "date-fns";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  OctagonAlert,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ScheduleFieldPicker,
  useScheduleField,
} from "@/components/calendar/schedule-field";
import { scheduleFieldText } from "@/components/calendar/schedule-field-display";
import {
  buildStatusTones,
  PriorityGlyph,
  toneOf,
  toneStyle,
} from "@/components/calendar/status-tone";
import ViewChoice from "@/components/calendar/view-choice";
import {
  barHorizontalBox,
  buildDependencyLines,
  type DependencyLine,
  type DependencyRelation,
  milestoneHorizontalBox,
} from "@/components/gantt/dependency-lines";
import GanttAddMilestone from "@/components/gantt/gantt-add-milestone";
import GanttCascadeDialog from "@/components/gantt/gantt-cascade-dialog";
import GanttDependencyLayer from "@/components/gantt/gantt-dependency-layer";
import GanttLinkPicker from "@/components/gantt/gantt-link-picker";
import GanttLinkPopover, {
  type SelectedLink,
} from "@/components/gantt/gantt-link-popover";
import GanttPeriodPicker from "@/components/gantt/gantt-period-picker";
import { GanttTaskBar } from "@/components/gantt/gantt-task-bar";
import GanttUndatedSection, {
  type UndatedDragData,
} from "@/components/gantt/gantt-undated-section";
import {
  buildGanttTimeline,
  centredDayScrollLeft,
  ganttZoomScale,
  remToPx,
  showsDayNumber,
  taskScheduleSpan,
} from "@/components/gantt/timeline";
import {
  matchesGanttSearch,
  selectUndatedTasks,
} from "@/components/gantt/undated-tasks";
import { useGanttDateCascade } from "@/components/gantt/use-gantt-date-cascade";
import { useGanttLinkDrag } from "@/components/gantt/use-gantt-link-drag";
import { useGanttRowCenters } from "@/components/gantt/use-gantt-row-centers";
import { useHideClippedMonthLabels } from "@/components/gantt/use-hide-clipped-month-labels";
import QuickAdd from "@/components/task-draft/quick-add";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ui/error-display";
import { Input } from "@/components/ui/input";
import { useUpdateTaskDates } from "@/hooks/mutations/task/use-update-task-dates";
import useCreateTaskRelation from "@/hooks/mutations/task-relation/use-create-task-relation";
import { useGetProjectDependencies } from "@/hooks/queries/task-relation/use-get-project-dependencies";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { getEntryColumn, withoutTriage } from "@/lib/column-groups";
import { formatDate, formatDateMedium, formatDateShort } from "@/lib/format";
import { HttpError } from "@/lib/http-error";
import { getPriorityLabel, getStatusLabel } from "@/lib/i18n/domain";
import { dayIndexAtPointer, scheduleFromDay } from "@/lib/schedule-dates";
import {
  assigneesOfTask,
  embeddedAssignees,
  formatAssigneeSummary,
} from "@/lib/task-assignees";
import { toast } from "@/lib/toast";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

/** The timeline track, which accepts undated tasks dropped onto it. */
function TimelineDropTrack({
  trackRef,
  className,
  style,
  children,
}: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  className: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "gantt-timeline" });
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        trackRef.current = node;
      }}
      className={cn(className, isOver && "bg-primary/5")}
      style={style}
    >
      {children}
    </div>
  );
}

type ProjectGanttProps = {
  workspaceId: string;
  projectId: string;
  /** The project as loaded, for colours and the entry column. */
  loadedProject: ProjectWithTasks | undefined;
  /** The project narrowed by the page's filters. */
  project: ProjectWithTasks | null;
  isLoading: boolean;
  /** The tasks could not be loaded (see useLoadFailure). */
  loadFailure: { error: unknown; retry: () => void } | null;
  /** The page's filter bar, drawn above the Gantt's own toolbar. */
  filterBar?: ReactNode;
  onOpenTask: (taskId: string) => void;
};

/**
 * A project's tasks on a timeline: dated bars with dependency lines, the
 * undated list and a quick add. The project page and project-scoped saved
 * views both draw it; each owns its data, filters and task sheet.
 */
export default function ProjectGantt({
  workspaceId,
  projectId,
  loadedProject,
  project,
  isLoading,
  loadFailure,
  filterBar,
  onOpenTask,
}: ProjectGanttProps) {
  const { t } = useTranslation();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const [searchQuery, setSearchQuery] = useState("");
  const [windowStart, setWindowStart] = useState<{
    projectId: string;
    date: Date;
  } | null>(null);
  const requestedStart =
    windowStart && windowStart.projectId === projectId
      ? windowStart.date
      : null;
  const showDate = (date: Date) => setWindowStart({ projectId, date });
  const isMobile = useIsMobile();
  const [isTaskRailOpen, setIsTaskRailOpen] = useState(false);

  const zoom = useScheduleViewPreferences((state) => state.ganttZoom);
  const setZoom = useScheduleViewPreferences((state) => state.setGanttZoom);
  const scheduleField = useScheduleField(projectId);
  // Wider day columns on small screens so dragging and reading dates is easier.
  const { dayColumnWidthRem, windowDays, labelEveryDay } = ganttZoomScale(
    zoom,
    isMobile,
  );
  const taskColumnWidthRem = isMobile ? 12 : 14;
  const showTaskRail = !isMobile || isTaskRailOpen;
  const railWidth = isMobile ? `${taskColumnWidthRem}rem` : "20rem";
  const { canUpdateTasks, canCreateTasks } = useWorkspacePermission();
  const canEditDates = Boolean(canUpdateTasks());
  // The rail's quick add lands new tasks in the project's entry column; they
  // start undated, so they show in the undated section.
  const entryColumn = canCreateTasks()
    ? (getEntryColumn(loadedProject?.columns ?? []) ??
      withoutTriage(loadedProject?.columns ?? [])[0])
    : undefined;
  const { mutate: updateTaskDates } = useUpdateTaskDates();
  const { data: dependencyData } = useGetProjectDependencies(projectId);
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [draggedUndated, setDraggedUndated] = useState<Task | null>(null);
  const [pixelsPerDay, setPixelsPerDay] = useState(44);
  const todayCellRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll once per visit to the view: re-running on every timeline
  // recalculation (e.g. a browser resize crossing the mobile breakpoint) would
  // yank the grid back to today out from under someone who deliberately
  // scrolled elsewhere.
  const hasCenteredOnTodayRef = useRef(false);
  // The Gantt project selector can swap `projectId` without unmounting this
  // route, so the one-time guard above has to be re-armed for the newly
  // selected project. Resetting it here (during render, comparing against the
  // previous projectId) rather than in an effect means it's already cleared
  // by the time the auto-center layout effect below runs for this project,
  // instead of one render later.
  const previousProjectIdRef = useRef(projectId);
  if (previousProjectIdRef.current !== projectId) {
    previousProjectIdRef.current = projectId;
    hasCenteredOnTodayRef.current = false;
  }

  useEffect(() => {
    if (!isMobile) {
      setIsTaskRailOpen(true);
      return;
    }

    setIsTaskRailOpen(false);
  }, [isMobile]);

  // From the unfiltered columns, so a filter never changes a task's colour.
  const tones = useMemo(
    () => buildStatusTones(loadedProject?.columns),
    [loadedProject?.columns],
  );

  const allTasks = useMemo(
    () => [
      ...(project?.columns.flatMap((column) => column.tasks) ?? []),
      ...(project?.plannedTasks ?? []),
    ],
    [project],
  );

  const parsedTasks = useMemo(() => {
    return allTasks
      .map((task) => {
        const span = taskScheduleSpan(task);
        return span ? { ...task, ...span } : null;
      })
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .sort(
        (left, right) =>
          left.scheduleStart.getTime() - right.scheduleStart.getTime(),
      );
  }, [allTasks]);

  const scheduledTasks = useMemo(
    () =>
      parsedTasks.filter((task) =>
        matchesGanttSearch(task, searchQuery, project?.slug),
      ),
    [parsedTasks, project?.slug, searchQuery],
  );

  const allUndatedTasks = useMemo(
    () => selectUndatedTasks(allTasks, ""),
    [allTasks],
  );
  const undatedTasks = useMemo(
    () => selectUndatedTasks(allUndatedTasks, searchQuery, project?.slug),
    [allUndatedTasks, searchQuery, project?.slug],
  );

  const timeline = useMemo(() => {
    // With only undated tasks there is still a timeline to drop them on,
    // centred on today.
    const today = new Date();
    const source =
      parsedTasks.length > 0
        ? parsedTasks
        : allUndatedTasks.length > 0
          ? [{ scheduleStart: today, scheduleEnd: today }]
          : [];
    return buildGanttTimeline(
      source,
      weekStartsOn,
      dayColumnWidthRem,
      requestedStart,
      today,
      windowDays,
    );
  }, [
    parsedTasks,
    allUndatedTasks.length,
    weekStartsOn,
    dayColumnWidthRem,
    requestedStart,
    windowDays,
  ]);

  // The header's month bands: each month's first visible day and length.
  const monthBands = useMemo(() => {
    const bands: { start: number; span: number; day: Date }[] = [];
    timeline?.days.forEach((day, index) => {
      const last = bands[bands.length - 1];
      if (last && isSameMonth(last.day, day)) last.span += 1;
      else bands.push({ start: index, span: 1, day });
    });
    return bands;
  }, [timeline]);

  // Whether "today" actually falls inside the computed date range. A project
  // made up entirely of past or far-future tasks has no "today" column to
  // jump to, so the button below is disabled in that case instead of doing
  // nothing silently.
  const todayIndex = useMemo(
    () => timeline?.days.findIndex((day) => isToday(day)) ?? -1,
    [timeline],
  );
  const todayInRange = todayIndex >= 0;

  // The task rail is `position: sticky; left: 0`, so it stays pinned over the
  // left edge of the scroll container's viewport rather than scrolling away
  // with the timeline underneath it. `scrollIntoView({ inline: "center" })`
  // has no way to know that, and centers the target against the *whole*
  // viewport width, landing today roughly half the rail's width left of
  // where it visually reads as centered. `scroll-padding-left` tells the
  // browser's own scroll-alignment math to treat the rail's width as inset
  // from the viewport, so "center" (and any future "start"/"end" alignment)
  // resolves against the space actually visible next to it.
  const scrollPaddingLeftRem = showTaskRail
    ? isMobile
      ? taskColumnWidthRem
      : 20
    : 0;

  // Centred by hand rather than with scrollIntoView, which lands anywhere in
  // a column and leaves a sliver of the day before it at the list's edge.
  const scrollToToday = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const scroller = scrollContainerRef.current;
      const todayCell = todayCellRef.current;
      if (!scroller || !todayCell || !timeline) return;
      scroller.scrollTo({
        left: centredDayScrollLeft({
          dayIndex: todayIndex,
          dayCount: timeline.days.length,
          columnPx: todayCell.getBoundingClientRect().width,
          viewportPx: scroller.clientWidth,
          railPx: showTaskRail ? (remToPx(railWidth) ?? 0) : 0,
        }),
        behavior,
      });
    },
    [timeline, todayIndex, showTaskRail, railWidth],
  );

  useLayoutEffect(() => {
    const element = timelineTrackRef.current;
    if (!element || !timeline) return;

    const update = () => {
      const count = timeline.days.length;
      if (count <= 0) return;
      setPixelsPerDay(element.clientWidth / count);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [timeline]);

  // Center the view on today the first time it becomes available, so opening
  // the Gantt chart on a long-running project doesn't drop you at the start
  // of the timeline with today scrolled off-screen. `projectId` is listed as
  // a dependency (even though the effect body doesn't use it directly)
  // because switching projects can leave `todayInRange` unchanged (true on
  // both the old and new project) while still resetting the one-time guard
  // above during render — without `projectId` here, React would bail out of
  // re-running this effect since neither `todayInRange` nor `scrollToToday`
  // actually changed value, and the newly selected project would never get
  // its auto-center.
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectId is intentionally listed to force a re-run on project switch; see comment above.
  useLayoutEffect(() => {
    if (
      hasCenteredOnTodayRef.current ||
      !todayInRange ||
      scheduledTasks.length === 0 ||
      !todayCellRef.current
    )
      return;
    hasCenteredOnTodayRef.current = true;
    scrollToToday("auto");
  }, [todayInRange, scrollToToday, projectId, scheduledTasks.length]);

  // A new zoom changes the column width under the same scroll offset; keep
  // the first visible day whole.
  useLayoutEffect(() => {
    const scroller = scrollContainerRef.current;
    const columnPx = remToPx(`${dayColumnWidthRem}rem`);
    if (!scroller || !columnPx) return;
    scroller.scrollLeft = Math.round(scroller.scrollLeft / columnPx) * columnPx;
  }, [dayColumnWidthRem]);

  useHideClippedMonthLabels(scrollContainerRef, {
    timeline,
    rail: showTaskRail ? railWidth : "0rem",
    active:
      !loadFailure &&
      !isLoading &&
      (scheduledTasks.length > 0 || undatedTasks.length > 0),
  });

  const relations = (dependencyData?.relations ?? []) as DependencyRelation[];
  const rowCenters = useGanttRowCenters(
    rowsRef,
    [scheduledTasks, undatedTasks.length, timeline, showTaskRail, zoom],
    relations.length > 0,
  );
  // Only bars inside the window (and so on screen once scrolled to) get
  // lines; recomputed when the bars, the window or the scale change.
  const dependencyLines = useMemo(() => {
    if (!timeline || relations.length === 0 || rowCenters.size === 0) return [];
    const bars = new Map<
      string,
      {
        span: (typeof scheduledTasks)[number];
        box: { left: number; right: number; centerY: number };
      }
    >();
    for (const task of scheduledTasks) {
      const centerY = rowCenters.get(task.id);
      if (centerY === undefined) continue;
      const box = task.isMilestone
        ? milestoneHorizontalBox(
            task.scheduleEnd,
            timeline.rangeStart,
            timeline.days.length,
            pixelsPerDay,
          )
        : barHorizontalBox(
            task,
            timeline.rangeStart,
            timeline.days.length,
            pixelsPerDay,
          );
      if (box) bars.set(task.id, { span: task, box: { ...box, centerY } });
    }
    return buildDependencyLines(relations, bars);
  }, [timeline, relations, rowCenters, scheduledTasks, pixelsPerDay]);
  const conflictTaskIds = useMemo(
    () =>
      new Set(
        dependencyLines
          .filter((line) => line.conflict)
          .map((line) => line.targetTaskId),
      ),
    [dependencyLines],
  );
  const blockedTaskIds = useMemo(
    () => new Set(dependencyData?.blockedTaskIds ?? []),
    [dependencyData?.blockedTaskIds],
  );

  // Every loaded task, not the filtered ones: a filter must not hide what a
  // date cascade would push, or what a link's popover names.
  const loadedTasks = useMemo(
    () => [
      ...(loadedProject?.columns.flatMap((column) => column.tasks) ?? []),
      ...(loadedProject?.plannedTasks ?? []),
    ],
    [loadedProject],
  );
  const cascade = useGanttDateCascade({
    projectId,
    tasks: loadedTasks,
    tones,
    relations,
  });
  const offerCascade = cascade.offer;

  const scheduleTask = useCallback(
    (task: Task, day: Date) => {
      updateTaskDates(
        // A milestone is a single date rather than the default span.
        { task, ...scheduleFromDay(day, task.isMilestone ? 1 : undefined) },
        {
          onError: (error) =>
            toast.error(error.message || t("tasks:gantt.updateDatesError")),
        },
      );
    },
    [updateTaskDates, t],
  );

  const openTask = onOpenTask;

  const { mutateAsync: createRelation } = useCreateTaskRelation();
  const [linkPickerTaskId, setLinkPickerTaskId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<SelectedLink | null>(null);
  const linkPreviewRef = useRef<SVGSVGElement>(null);

  // A drawn line reads "the source finishes, then the target starts": blocks.
  const handleLinkDrawn = useCallback(
    async (sourceTaskId: string, targetTaskId: string) => {
      try {
        const relation = await createRelation({
          sourceTaskId,
          targetTaskId,
          relationType: "blocks",
        });
        toast.success(t("tasks:relations.added"));
        offerCascade(sourceTaskId, {
          relation: {
            id: relation.id,
            sourceTaskId,
            targetTaskId,
            relationType: "blocks",
          },
        });
      } catch (error) {
        // The API says why: already related, a loop, a task in intake.
        const reason =
          error instanceof HttpError &&
          (error.status === 400 || error.status === 409) &&
          error.message;
        toast.error(reason || t("tasks:relations.linkError"));
      }
    },
    [createRelation, offerCascade, t],
  );

  const startLinkDrag = useGanttLinkDrag({
    previewRef: linkPreviewRef,
    onLink: handleLinkDrawn,
    onClick: setLinkPickerTaskId,
  });

  // Kept relative to the rows, so the popover follows the chart's scroll.
  const handleLineClick = useCallback(
    (line: DependencyLine, x: number, y: number) => {
      const rows = rowsRef.current?.getBoundingClientRect();
      setSelectedLink({
        line,
        x: x - (rows?.left ?? 0),
        y: y - (rows?.top ?? 0),
      });
    },
    [],
  );

  const handleDatesChanged = useCallback(
    (taskId: string, span: { scheduleStart: Date; scheduleEnd: Date }) =>
      offerCascade(taskId, { rootSpan: span }),
    [offerCascade],
  );

  const titleOf = (taskId: string) =>
    loadedTasks.find((task) => task.id === taskId)?.title ?? "";

  // Same thresholds as the board, so a press on the handle is not a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
  );

  const handleUndatedDragStart = ({ active }: DragStartEvent) => {
    const data = active.data.current as UndatedDragData | undefined;
    setDraggedUndated(
      undatedTasks.find((task) => task.id === data?.taskId) ?? null,
    );
  };

  // The drop day comes from where the pointer lets go over the timeline
  // track; letting go over the task list (or outside) does nothing.
  const handleUndatedDragEnd = ({
    active,
    activatorEvent,
    delta,
    over,
  }: DragEndEvent) => {
    setDraggedUndated(null);
    const data = active.data.current as UndatedDragData | undefined;
    const task = undatedTasks.find((entry) => entry.id === data?.taskId);
    const track = timelineTrackRef.current;
    const scroller = scrollContainerRef.current;
    if (!task || !timeline || !track || !scroller || !over) return;
    const startX =
      "clientX" in activatorEvent && typeof activatorEvent.clientX === "number"
        ? activatorEvent.clientX
        : typeof TouchEvent !== "undefined" &&
            activatorEvent instanceof TouchEvent
          ? (activatorEvent.changedTouches[0]?.clientX ?? null)
          : null;
    if (startX === null) return;
    const dropX = startX + delta.x;
    const trackRect = track.getBoundingClientRect();
    const railRight =
      scroller.getBoundingClientRect().left +
      (showTaskRail ? (remToPx(railWidth) ?? 0) : 0);
    if (dropX < Math.max(trackRect.left, railRight) || dropX > trackRect.right)
      return;
    const index = dayIndexAtPointer(
      dropX,
      trackRect.left,
      trackRect.width,
      timeline.days.length,
    );
    const day = timeline.days[index];
    if (day) scheduleTask(task, day);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {filterBar}
      <div className="shrink-0 border-border/80 border-b px-2 py-1.5 md:px-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h1 className="sr-only">{t("tasks:gantt.title")}</h1>

          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("tasks:gantt.searchPlaceholder")}
              className="h-9 touch-manipulation sm:h-7 [&_[data-slot=input]]:pl-8 [&_[data-slot=input]]:text-xs"
            />
          </div>

          {timeline && (
            <div className="flex flex-wrap items-center gap-1.5 sm:ms-auto">
              {entryColumn ? (
                <GanttAddMilestone
                  projectId={projectId}
                  status={entryColumn.slug}
                  onCreated={(day) => {
                    if (day < timeline.rangeStart || day > timeline.rangeEnd) {
                      showDate(addDays(day, -7));
                    }
                  }}
                />
              ) : null}
              <ScheduleFieldPicker
                fields={scheduleField.fields}
                value={scheduleField.fieldId}
                onChange={scheduleField.setFieldId}
              />
              <ViewChoice
                label={t("tasks:gantt.zoom")}
                value={zoom}
                onChange={setZoom}
                options={[
                  { value: "week", label: t("tasks:gantt.zoomWeek") },
                  { value: "month", label: t("tasks:gantt.zoomMonth") },
                  { value: "quarter", label: t("tasks:gantt.zoomQuarter") },
                ]}
              />
              {/* One unit, so a narrow toolbar never wraps the arrows
                  away from the period they step. */}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon-xs"
                  aria-label={t("tasks:gantt.previousPeriod")}
                  disabled={!timeline.hasPrevious}
                  onClick={() =>
                    showDate(addDays(timeline.rangeStart, -timeline.windowDays))
                  }
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <GanttPeriodPicker
                  start={timeline.rangeStart}
                  end={timeline.rangeEnd}
                  minimumStart={timeline.minimumStart}
                  maximumStart={timeline.maximumStart}
                  onPick={showDate}
                />
                <Button
                  variant="outline"
                  size="icon-xs"
                  aria-label={t("tasks:gantt.nextPeriod")}
                  disabled={!timeline.hasNext}
                  onClick={() =>
                    showDate(addDays(timeline.rangeStart, timeline.windowDays))
                  }
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}

          <Button
            variant="outline"
            size="xs"
            className={cn("touch-manipulation", !timeline && "sm:ms-auto")}
            onClick={() => scrollToToday()}
            disabled={!todayInRange || scheduledTasks.length === 0}
          >
            <Calendar className="size-3.5" />
            {t("tasks:gantt.jumpToToday")}
          </Button>

          <Button
            variant="outline"
            size="xs"
            className="touch-manipulation sm:hidden"
            onClick={() => setIsTaskRailOpen((current) => !current)}
          >
            {showTaskRail ? (
              <ChevronLeft className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {showTaskRail
              ? t("tasks:gantt.hideTasks")
              : t("tasks:gantt.showTasks")}
          </Button>
        </div>
      </div>

      {loadFailure ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <ErrorDisplay error={loadFailure.error} onRetry={loadFailure.retry} />
        </div>
      ) : isLoading ? (
        // Not "No scheduled tasks" while the tasks are still on their way.
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-muted-foreground text-sm">
            {t("common:empty.loading")}
          </p>
        </div>
      ) : !timeline ||
        (parsedTasks.length === 0 && allUndatedTasks.length === 0) ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <h2 className="text-sm font-semibold text-foreground">
              {t("tasks:gantt.noTasks")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("tasks:gantt.noTasksSubtitle")}
            </p>
          </div>
        </div>
      ) : scheduledTasks.length === 0 && undatedTasks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <h2 className="text-sm font-semibold text-foreground">
              {t("tasks:gantt.noTasksFound")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("tasks:gantt.noTasksMatch", { query: searchQuery })}
            </p>
          </div>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleUndatedDragStart}
          onDragEnd={handleUndatedDragEnd}
          onDragCancel={() => setDraggedUndated(null)}
        >
          <div
            ref={scrollContainerRef}
            data-testid="gantt-scroll-container"
            // A size container, so the undated list can span its visible
            // width on a phone.
            className="@container min-h-0 flex-1 overflow-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
            style={{ scrollPaddingLeft: `${scrollPaddingLeftRem}rem` }}
          >
            <div className="relative min-w-max touch-pan-x touch-pan-y">
              <div className="sticky top-0 z-20 flex border-b border-border bg-background/95 backdrop-blur">
                {showTaskRail ? (
                  <div
                    className="sticky left-0 z-30 flex shrink-0 items-end border-r border-border bg-background px-2 py-2.5 sm:w-80 sm:px-3"
                    style={{
                      width: isMobile ? `${taskColumnWidthRem}rem` : undefined,
                    }}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("tasks:gantt.taskHeader")}
                    </p>
                  </div>
                ) : null}
                <div
                  className="flex shrink-0 flex-col"
                  style={{ minWidth: `${timeline.timelineMinWidthRem}rem` }}
                >
                  <div
                    className="grid border-b border-border/70"
                    style={{
                      gridTemplateColumns: timeline.gridTemplateColumns,
                    }}
                  >
                    {monthBands.map((band) => (
                      <div
                        key={`month-${band.day.toISOString()}`}
                        data-gantt-month-band
                        className="min-w-0 overflow-clip border-r border-border px-2 py-1"
                        style={{
                          gridColumn: `${band.start + 1} / span ${band.span}`,
                        }}
                      >
                        {/* Stays readable while the month scrolls by. */}
                        <span
                          data-gantt-month-label
                          className="sticky block w-max text-xs font-semibold text-foreground"
                          style={{
                            left: `calc(${showTaskRail ? railWidth : "0rem"} + 0.5rem)`,
                          }}
                        >
                          {formatDate(band.day, {
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: timeline.gridTemplateColumns,
                    }}
                  >
                    {timeline.days.map((day, index) => {
                      const isCurrentDay = index === todayIndex;
                      // Quarter columns are too narrow for the "Today"
                      // pill, so it hides the labels it would run into.
                      const coveredByToday =
                        !labelEveryDay &&
                        todayIndex >= 0 &&
                        !isCurrentDay &&
                        Math.abs(index - todayIndex) <= 2;
                      // Each week start says which date it is (the month
                      // band names the month).
                      const weekLabel =
                        day.getDay() === weekStartsOn && !coveredByToday
                          ? formatDateShort(day)
                          : "";

                      return (
                        <div
                          key={day.toISOString()}
                          ref={isCurrentDay ? todayCellRef : undefined}
                          data-today={isCurrentDay || undefined}
                          className={cn(
                            "border-r border-border/70 px-0.5 pt-1 pb-1.5 text-center sm:px-1",
                            isWeekend(day) && "bg-(color:--weekend-tint)",
                          )}
                        >
                          <div className="relative z-[1] flex h-4 items-center justify-center whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                            {isCurrentDay ? (
                              <span className="relative z-[2] rounded-full bg-(color:--today) px-1.5 py-px text-[9px] font-semibold uppercase leading-3 tracking-wide text-background">
                                {t("tasks:calendar.today")}
                              </span>
                            ) : (
                              weekLabel
                            )}
                          </div>
                          <div
                            className={cn(
                              "mx-auto flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                              !labelEveryDay && "size-4 text-[10px]",
                              isCurrentDay &&
                                "bg-(color:--today) font-semibold text-background",
                            )}
                          >
                            {(showsDayNumber(
                              day,
                              index,
                              labelEveryDay,
                              weekStartsOn,
                            ) &&
                              !coveredByToday) ||
                            isCurrentDay
                              ? format(day, "d")
                              : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="relative">
                <TimelineDropTrack
                  trackRef={timelineTrackRef}
                  className="absolute inset-y-0 z-0 grid"
                  style={{
                    left: showTaskRail
                      ? isMobile
                        ? `${taskColumnWidthRem}rem`
                        : "20rem"
                      : "0rem",
                    gridTemplateColumns: timeline.gridTemplateColumns,
                    width: `${timeline.timelineMinWidthRem}rem`,
                  }}
                >
                  {timeline.days.map((day) => (
                    <div
                      key={`bg-line-${day.toISOString()}`}
                      className={cn(
                        "relative h-full min-h-0 border-r border-border/60",
                        isWeekend(day) && "bg-(color:--weekend-tint)",
                      )}
                    >
                      {isToday(day) ? (
                        <span
                          aria-hidden="true"
                          data-testid="gantt-today-line"
                          className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-(color:--today)"
                        />
                      ) : null}
                    </div>
                  ))}
                </TimelineDropTrack>

                <div ref={rowsRef} className="relative z-10 flex flex-col">
                  {scheduledTasks.map((task, rowIndex) => {
                    const tone = toneOf(task.status, tones);
                    const striped = rowIndex % 2 === 1;
                    const assigneeSummary =
                      assigneesOfTask(task).length > 0
                        ? ` · ${formatAssigneeSummary(embeddedAssignees(task), t)}`
                        : "";
                    const fieldValue = scheduleField.display?.values.get(
                      task.id,
                    );
                    const fieldText = scheduleFieldText(
                      scheduleField.display,
                      task.id,
                      t,
                    );
                    return (
                      <div
                        key={task.id}
                        data-gantt-row={task.id}
                        className={cn(
                          "grid items-stretch border-b border-border/60 data-[gantt-link-target]:bg-primary/10",
                          striped && "bg-foreground/[0.025]",
                        )}
                        style={{
                          gridTemplateColumns: showTaskRail
                            ? isMobile
                              ? `${taskColumnWidthRem}rem max-content`
                              : "20rem max-content"
                            : "max-content",
                        }}
                      >
                        {showTaskRail ? (
                          <div
                            className={cn(
                              "sticky left-0 z-[11] flex h-full flex-col justify-center border-r border-border",
                              // Opaque, as bars scroll under it; the same
                              // stripe as the row, mixed in.
                              striped
                                ? "bg-[color-mix(in_srgb,var(--foreground)_2.5%,var(--background))]"
                                : "bg-background",
                            )}
                          >
                            <button
                              type="button"
                              title={`${formatDateMedium(task.scheduleStart)} – ${formatDateMedium(task.scheduleEnd)}${fieldText ? ` · ${fieldText}` : ""}${assigneeSummary}`}
                              className="flex min-h-[44px] w-full min-w-0 items-center gap-2 px-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-10 sm:px-3"
                              onClick={() => onOpenTask(task.id)}
                            >
                              <span
                                aria-hidden="true"
                                style={toneStyle(tone)}
                                className="size-2 shrink-0 rounded-full bg-(color:--tone) ring-2 ring-(color:--tone)/20"
                              />
                              <span className="sr-only">
                                {getStatusLabel(task.status)}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                {project?.slug}-{task.number}
                              </span>
                              {conflictTaskIds.has(task.id) ? (
                                <TriangleAlert
                                  role="img"
                                  aria-label={t(
                                    "tasks:gantt.dependencyConflict",
                                  )}
                                  className="size-3.5 shrink-0 text-(color:--dependency-conflict)"
                                >
                                  <title>
                                    {t("tasks:gantt.dependencyConflict")}
                                  </title>
                                </TriangleAlert>
                              ) : null}
                              {blockedTaskIds.has(task.id) ? (
                                <OctagonAlert
                                  role="img"
                                  aria-label={t("tasks:gantt.blocked")}
                                  className="size-3.5 shrink-0 text-muted-foreground"
                                >
                                  <title>{t("tasks:gantt.blocked")}</title>
                                </OctagonAlert>
                              ) : null}
                              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                                {task.title}
                              </span>
                              {fieldValue ? (
                                <span
                                  data-testid="gantt-field-value"
                                  className="max-w-[40%] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                >
                                  <span aria-hidden="true">{fieldValue}</span>
                                  <span className="sr-only">{fieldText}</span>
                                </span>
                              ) : null}
                              <PriorityGlyph
                                priority={task.priority}
                                label={getPriorityLabel(
                                  task.priority ?? "no-priority",
                                )}
                              />
                            </button>
                            {(task.scheduleEnd < timeline.rangeStart ||
                              task.scheduleStart > timeline.rangeEnd) && (
                              <button
                                type="button"
                                className="self-start px-3 pb-2 text-xs text-primary underline"
                                onClick={() =>
                                  showDate(addDays(task.scheduleStart, -7))
                                }
                              >
                                {t("tasks:gantt.showTaskDates")}
                              </button>
                            )}
                          </div>
                        ) : null}

                        <div
                          className="relative min-h-11 shrink-0 overflow-x-clip select-none sm:min-h-10"
                          style={{
                            minWidth: `${timeline.timelineMinWidthRem}rem`,
                          }}
                        >
                          <GanttTaskBar
                            task={task}
                            timeline={timeline}
                            pixelsPerDay={pixelsPerDay}
                            isMobile={isMobile}
                            canEdit={canEditDates}
                            tone={tone}
                            onOpenTask={() => onOpenTask(task.id)}
                            onLinkPointerDown={startLinkDrag}
                            onLinkKeyboard={setLinkPickerTaskId}
                            onDatesChanged={handleDatesChanged}
                          />
                        </div>
                      </div>
                    );
                  })}

                  <GanttUndatedSection
                    tasks={undatedTasks}
                    projectSlug={project?.slug}
                    railWidth={railWidth}
                    wide={isMobile}
                    timelineMinWidthRem={timeline.timelineMinWidthRem}
                    canEdit={canEditDates}
                    onOpenTask={openTask}
                    onSchedule={(task) => scheduleTask(task, new Date())}
                    tones={tones}
                  />

                  {showTaskRail && entryColumn ? (
                    <div
                      data-gantt-quick-add
                      className="grid border-b border-border/60"
                      style={{
                        gridTemplateColumns: isMobile
                          ? `${taskColumnWidthRem}rem max-content`
                          : "20rem max-content",
                      }}
                    >
                      <div className="sticky left-0 z-[11] border-r border-border bg-background px-1 py-1">
                        <QuickAdd
                          projectId={projectId}
                          workspaceId={workspaceId}
                          prefill={{
                            status: entryColumn.slug,
                            targetName: entryColumn.name,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          minWidth: `${timeline.timelineMinWidthRem}rem`,
                        }}
                      />
                    </div>
                  ) : null}

                  {/* Last in the rows' stacking context: over the empty row
                      space, so a line can take a click, and under the bars
                      (z-[1]) and the task list (z-[11]). */}
                  <GanttDependencyLayer
                    lines={dependencyLines}
                    left={showTaskRail ? railWidth : "0rem"}
                    widthRem={timeline.timelineMinWidthRem}
                    onLineClick={canEditDates ? handleLineClick : undefined}
                  />
                  <svg
                    ref={linkPreviewRef}
                    aria-hidden="true"
                    data-testid="gantt-link-preview"
                    className="pointer-events-none invisible absolute top-0 z-[2] h-full overflow-visible"
                    style={{
                      left: showTaskRail ? railWidth : "0rem",
                      width: `${timeline.timelineMinWidthRem}rem`,
                    }}
                  >
                    <path
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {draggedUndated ? (
              <div className="max-w-56 truncate rounded-md border border-primary/40 bg-background px-2 py-1 text-xs font-medium text-foreground shadow-lg ring-2 ring-primary/20">
                {draggedUndated.title}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      {linkPickerTaskId ? (
        <GanttLinkPicker
          taskId={linkPickerTaskId}
          projectId={projectId}
          workspaceId={workspaceId}
          onClose={() => setLinkPickerTaskId(null)}
        />
      ) : null}
      <GanttLinkPopover
        selected={selectedLink}
        rowsRef={rowsRef}
        titleOf={titleOf}
        onClose={() => setSelectedLink(null)}
        onReviewDates={cascade.review}
      />
      <GanttCascadeDialog
        rows={cascade.preview}
        projectSlug={loadedProject?.slug}
        isApplying={cascade.isApplying}
        onCancel={cascade.cancel}
        onConfirm={() => void cascade.confirm()}
      />
    </div>
  );
}
