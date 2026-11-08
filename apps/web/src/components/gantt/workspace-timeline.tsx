import { useNavigate } from "@tanstack/react-router";
import { addDays, format, isSameMonth, isToday, isWeekend } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ProjectIcon } from "@/components/analytics/category-label";
import {
  buildStatusTones,
  isClosedTone,
  type ToneInfo,
  toneOf,
  toneStyle,
} from "@/components/calendar/status-tone";
import ViewChoice from "@/components/calendar/view-choice";
import GanttPeriodPicker from "@/components/gantt/gantt-period-picker";
import {
  buildGanttTimeline,
  centredDayScrollLeft,
  ganttZoomScale,
  remToPx,
  showsDayNumber,
} from "@/components/gantt/timeline";
import { useHideClippedMonthLabels } from "@/components/gantt/use-hide-clipped-month-labels";
import {
  barColumns,
  datedOnlyFilter,
  type TimelineRow,
  timelineSections,
} from "@/components/gantt/workspace-timeline-model";
import {
  QueryEmpty,
  QueryRowsSkeleton,
} from "@/components/task-layouts/query-states";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ui/error-display";
import { useTaskQueryRows } from "@/hooks/queries/task-query/use-task-query-rows";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/cn";
import { formatDate, formatDateMedium } from "@/lib/format";
import { getStatusLabel } from "@/lib/i18n/domain";
import type {
  FilterCondition,
  TaskQueryScope,
  TaskQueryState,
} from "@/lib/task-query/model";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import { useUserPreferencesStore } from "@/store/user-preferences";

/** Rows per project; each section loads more on its own. */
const ROWS_PER_PROJECT = 50;

type WorkspaceTimelineProps = {
  workspaceId: string;
  scope: TaskQueryScope;
  state: TaskQueryState;
  baseConditions?: readonly FilterCondition[];
  onClearFilters?: () => void;
};

/** A read-only bar: click it or its row to open the task. */
function TimelineBar({
  row,
  tone,
  columns,
  gridTemplateColumns,
  onOpen,
}: {
  row: TimelineRow;
  tone: ToneInfo;
  columns: { start: number; end: number };
  gridTemplateColumns: string;
  onOpen: () => void;
}) {
  const closed = isClosedTone(tone.tone);
  return (
    <div
      className="pointer-events-none absolute inset-0 grid items-center"
      style={{ gridTemplateColumns }}
    >
      <button
        type="button"
        title={row.title}
        aria-label={row.title}
        data-timeline-bar={row.id}
        onClick={onOpen}
        style={
          {
            ...toneStyle(tone),
            gridColumn: `${columns.start} / ${columns.end}`,
          } as CSSProperties
        }
        className={cn(
          "pointer-events-auto relative mx-1 flex min-h-[44px] min-w-0 items-center overflow-hidden rounded-md border border-(color:--tone)/40 bg-(color:--tone-tint) px-1.5 text-left font-medium text-(color:--tone-fg) text-xs hover:border-(color:--tone)/70 focus-visible:outline-none sm:h-6 sm:min-h-0 focus-visible:ring-2 focus-visible:ring-ring",
          closed && "text-muted-foreground",
          tone.tone === "cancelled" && "line-through",
        )}
      >
        <span className="min-w-0 truncate">{row.title}</span>
      </button>
    </div>
  );
}

/**
 * Tasks with dates across the projects you can see, one section per project.
 * It reads task query rows, so restricted projects and the view's filters
 * apply as in the view's other layouts. Dates are changed in the task or on
 * the project's own Gantt: dependencies and scheduling stay per project.
 */
export default function WorkspaceTimeline({
  workspaceId,
  scope,
  state,
  baseConditions,
  onClearFilters,
}: WorkspaceTimelineProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const weekStartsOn = useUserPreferencesStore((store) => store.weekStartsOn);
  const zoom = useScheduleViewPreferences((store) => store.ganttZoom);
  const setZoom = useScheduleViewPreferences((store) => store.setGanttZoom);
  const { dayColumnWidthRem, windowDays, labelEveryDay } = ganttZoomScale(
    zoom,
    isMobile,
  );
  const railRem = isMobile ? 11 : 20;
  const [requestedStart, setRequestedStart] = useState<Date | null>(null);

  const timelineState = useMemo<TaskQueryState>(
    () => ({
      ...state,
      filters: datedOnlyFilter(state.filters),
      display: {
        ...state.display,
        groupBy: "project",
        subGroupBy: null,
        orderBy: { field: "dueDate", direction: "asc" },
        showEmptyGroups: false,
      },
    }),
    [state],
  );
  const query = useTaskQueryRows({
    workspaceId,
    scope,
    state: timelineState,
    baseConditions,
    limit: ROWS_PER_PROJECT,
  });
  const { data } = query;

  const sections = useMemo(() => (data ? timelineSections(data) : []), [data]);
  const tones = useMemo(() => {
    const byProject = new Map<string, ReadonlyMap<string, ToneInfo>>();
    for (const section of sections) {
      byProject.set(
        section.projectId,
        buildStatusTones(
          data?.meta.columns.filter(
            (column) => column.projectId === section.projectId,
          ),
        ),
      );
    }
    return byProject;
  }, [data, sections]);

  const timeline = useMemo(() => {
    const rows = sections.flatMap((section) => section.rows);
    return buildGanttTimeline(
      rows,
      weekStartsOn,
      dayColumnWidthRem,
      requestedStart,
      new Date(),
      windowDays,
    );
  }, [sections, weekStartsOn, dayColumnWidthRem, requestedStart, windowDays]);

  const monthBands = useMemo(() => {
    const bands: { start: number; span: number; day: Date }[] = [];
    timeline?.days.forEach((day, index) => {
      const last = bands[bands.length - 1];
      if (last && isSameMonth(last.day, day)) last.span += 1;
      else bands.push({ start: index, span: 1, day });
    });
    return bands;
  }, [timeline]);
  const todayIndex = timeline?.days.findIndex((day) => isToday(day)) ?? -1;

  const todayCellRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // To a whole column, as on the project Gantt: scrollIntoView lands
  // anywhere in one and leaves a sliver of the day before at the list's edge.
  const dayCount = timeline?.days.length ?? 0;
  const scrollToToday = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const scroller = scrollerRef.current;
      const todayCell = todayCellRef.current;
      if (!scroller || !todayCell) return;
      scroller.scrollTo({
        left: centredDayScrollLeft({
          dayIndex: todayIndex,
          dayCount,
          columnPx: todayCell.getBoundingClientRect().width,
          viewportPx: scroller.clientWidth,
          railPx: remToPx(`${railRem}rem`) ?? 0,
        }),
        behavior,
      });
    },
    [todayIndex, dayCount, railRem],
  );
  useHideClippedMonthLabels(scrollerRef, {
    timeline: sections.length > 0 ? timeline : null,
    rail: `${railRem}rem`,
  });
  const centeredOnToday = useRef(false);
  useLayoutEffect(() => {
    if (centeredOnToday.current || todayIndex < 0) return;
    centeredOnToday.current = true;
    scrollToToday("auto");
  }, [todayIndex, scrollToToday]);

  const openTask = useCallback(
    (taskId: string) =>
      navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          taskId,
        }),
        replace: true,
      }),
    [navigate],
  );

  if (!data) {
    if (query.isError) {
      return (
        <div className="p-4">
          <ErrorDisplay
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </div>
      );
    }
    return <QueryRowsSkeleton />;
  }

  if (!timeline || sections.length === 0) {
    return (
      <QueryEmpty
        onClear={onClearFilters}
        title={t("tasks:gantt.noTasks")}
        description={t("tasks:gantt.workspaceNoTasksSubtitle")}
      />
    );
  }

  const trackStyle = { minWidth: `${timeline.timelineMinWidthRem}rem` };
  const rowColumns = `${railRem}rem max-content`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-border/80 border-b px-2 py-1.5 md:px-3">
        <h2 className="sr-only">{t("tasks:gantt.title")}</h2>
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
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={t("tasks:gantt.previousPeriod")}
          disabled={!timeline.hasPrevious}
          onClick={() =>
            setRequestedStart(
              addDays(timeline.rangeStart, -timeline.windowDays),
            )
          }
        >
          <ChevronLeft className="size-4" />
        </Button>
        <GanttPeriodPicker
          start={timeline.rangeStart}
          end={timeline.rangeEnd}
          minimumStart={timeline.minimumStart}
          maximumStart={timeline.maximumStart}
          onPick={setRequestedStart}
        />
        <Button
          variant="outline"
          size="icon-xs"
          aria-label={t("tasks:gantt.nextPeriod")}
          disabled={!timeline.hasNext}
          onClick={() =>
            setRequestedStart(addDays(timeline.rangeStart, timeline.windowDays))
          }
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => scrollToToday()}
          disabled={todayIndex < 0}
        >
          <Calendar className="size-3.5" />
          {t("tasks:gantt.jumpToToday")}
        </Button>
      </div>

      <div
        ref={scrollerRef}
        data-testid="workspace-timeline-scroll"
        className="min-h-0 flex-1 overflow-auto overscroll-x-contain"
        style={{ scrollPaddingLeft: `${railRem}rem` }}
      >
        <div className="relative min-w-max">
          <div className="sticky top-0 z-20 flex border-border border-b bg-background">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-end border-border border-r bg-background px-3 py-2.5"
              style={{ width: `${railRem}rem` }}
            >
              <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
                {t("tasks:gantt.taskHeader")}
              </p>
            </div>
            <div className="flex shrink-0 flex-col" style={trackStyle}>
              <div
                className="grid border-border/70 border-b"
                style={{ gridTemplateColumns: timeline.gridTemplateColumns }}
              >
                {monthBands.map((band) => (
                  <div
                    key={band.day.toISOString()}
                    data-gantt-month-band
                    className="min-w-0 overflow-clip border-border border-r px-2 py-1"
                    style={{
                      gridColumn: `${band.start + 1} / span ${band.span}`,
                    }}
                  >
                    <span
                      data-gantt-month-label
                      className="sticky block w-max font-semibold text-foreground text-xs"
                      style={{ left: `calc(${railRem}rem + 0.5rem)` }}
                    >
                      {formatDate(band.day, { month: "long", year: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="grid"
                style={{ gridTemplateColumns: timeline.gridTemplateColumns }}
              >
                {timeline.days.map((day, index) => (
                  <div
                    key={day.toISOString()}
                    ref={index === todayIndex ? todayCellRef : undefined}
                    data-today={index === todayIndex || undefined}
                    className={cn(
                      "flex h-7 items-center justify-center border-border/70 border-r text-[10px] text-muted-foreground tabular-nums",
                      isWeekend(day) && "bg-(color:--weekend-tint)",
                    )}
                  >
                    {index === todayIndex ? (
                      <span className="rounded-full bg-(color:--today) px-1.5 py-px font-semibold text-background">
                        {format(day, "d")}
                      </span>
                    ) : showsDayNumber(
                        day,
                        index,
                        labelEveryDay,
                        weekStartsOn,
                      ) ? (
                      format(day, "d")
                    ) : (
                      ""
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-y-0 grid"
              style={{
                left: `${railRem}rem`,
                gridTemplateColumns: timeline.gridTemplateColumns,
                width: `${timeline.timelineMinWidthRem}rem`,
              }}
            >
              {timeline.days.map((day, index) => (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "relative border-border/60 border-r",
                    isWeekend(day) && "bg-(color:--weekend-tint)",
                  )}
                >
                  {index === todayIndex && (
                    <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-(color:--today)" />
                  )}
                </div>
              ))}
            </div>

            <div className="relative flex flex-col">
              {sections.map((section) => {
                const sectionTones = tones.get(section.projectId);
                return (
                  <section
                    key={section.projectId}
                    aria-label={section.name}
                    className="contents"
                  >
                    <div
                      className="grid border-border/60 border-b"
                      style={{ gridTemplateColumns: rowColumns }}
                    >
                      <div className="sticky left-0 z-[11] flex min-h-8 items-center gap-1.5 border-border border-r bg-muted px-3">
                        <ProjectIcon
                          icon={section.icon}
                          seed={section.projectId}
                        />
                        <h3 className="min-w-0 truncate font-semibold text-foreground text-xs">
                          {section.name}
                        </h3>
                        <span className="ms-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
                          {section.count}
                        </span>
                      </div>
                      <div className="bg-muted/40" style={trackStyle} />
                    </div>
                    {section.rows.map((row) => {
                      const tone = toneOf(row.status, sectionTones);
                      const columns = barColumns(
                        row,
                        timeline.rangeStart,
                        timeline.days.length,
                      );
                      return (
                        <div
                          key={row.id}
                          data-timeline-row={row.id}
                          className="grid border-border/60 border-b"
                          style={{ gridTemplateColumns: rowColumns }}
                        >
                          <div className="sticky left-0 z-[11] flex flex-col justify-center border-border border-r bg-background">
                            <button
                              type="button"
                              title={`${formatDateMedium(row.scheduleStart)} – ${formatDateMedium(row.scheduleEnd)}`}
                              className="flex min-h-11 w-full min-w-0 items-center gap-2 px-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-h-9"
                              onClick={() => openTask(row.id)}
                            >
                              <span
                                aria-hidden
                                style={toneStyle(tone)}
                                className="size-2 shrink-0 rounded-full bg-(color:--tone)"
                              />
                              <span className="sr-only">
                                {getStatusLabel(row.status)}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                {row.key}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium text-foreground text-xs">
                                {row.title}
                              </span>
                            </button>
                            {!columns && (
                              <button
                                type="button"
                                className="self-start px-3 pb-2 text-primary text-xs underline"
                                onClick={() =>
                                  setRequestedStart(
                                    addDays(row.scheduleStart, -7),
                                  )
                                }
                              >
                                {t("tasks:gantt.showTaskDates")}
                              </button>
                            )}
                          </div>
                          <div
                            className="relative min-h-11 select-none sm:min-h-9"
                            style={trackStyle}
                          >
                            {columns && (
                              <TimelineBar
                                row={row}
                                tone={tone}
                                columns={columns}
                                gridTemplateColumns={
                                  timeline.gridTemplateColumns
                                }
                                onOpen={() => openTask(row.id)}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {section.hasMore && (
                      <div
                        className="grid border-border/60 border-b"
                        style={{ gridTemplateColumns: rowColumns }}
                      >
                        <div className="sticky left-0 z-[11] border-border border-r bg-background px-2 py-1">
                          <Button
                            variant="ghost"
                            size="xs"
                            loading={query.isLoadingMore(section.projectId)}
                            onClick={() => query.loadMore(section.projectId)}
                          >
                            {t("tasks:gantt.showMoreTasks")}
                          </Button>
                        </div>
                        <div style={trackStyle} />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
