import type { ViewTask } from "../views-shared/data";

export type CalendarMode = "month" | "week";

export type CalendarViewState = { tasks: ViewTask[]; mode: CalendarMode };

export type CalendarViewAction =
  | { type: "reschedule"; id: string; day: number }
  | { type: "mode"; mode: CalendarMode };

/** Monday, September 28: the first cell of the October grid. */
export const MONTH_START = -2;
export const MONTH_WEEKS = 5;
/** The week the Week mode shows: Monday, October 12 to Sunday, October 18. */
export const WEEK_START = 12;

export function calendarViewReducer(
  state: CalendarViewState,
  action: CalendarViewAction,
): CalendarViewState {
  switch (action.type) {
    case "reschedule":
      return {
        ...state,
        // The task keeps its length; it now starts on the drop day.
        tasks: state.tasks.map((task) =>
          task.id === action.id
            ? {
                ...task,
                start: action.day,
                end: action.day + (task.end - task.start),
              }
            : task,
        ),
      };
    case "mode":
      return { ...state, mode: action.mode };
  }
}

export type WeekSegment = {
  task: ViewTask;
  /** 0-based columns, both included. */
  from: number;
  to: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/**
 * Lays one week's tasks into lanes, like the app's month grid: earlier and
 * longer bars first, each in the first lane that is free. Bars past
 * `maxLanes` are counted per day instead.
 */
export function packWeek(
  tasks: readonly ViewTask[],
  weekStart: number,
  maxLanes: number,
): { segments: WeekSegment[]; hidden: number[] } {
  const weekEnd = weekStart + 6;
  const candidates = tasks
    .filter((task) => task.end >= weekStart && task.start <= weekEnd)
    .map((task) => ({
      task,
      from: Math.max(task.start, weekStart) - weekStart,
      to: Math.min(task.end, weekEnd) - weekStart,
    }))
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  const laneEnds: number[] = [];
  const segments: WeekSegment[] = [];
  const hidden = [0, 0, 0, 0, 0, 0, 0];
  for (const candidate of candidates) {
    let lane = laneEnds.findIndex((end) => end < candidate.from);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= maxLanes) {
      for (let day = candidate.from; day <= candidate.to; day++) {
        hidden[day] = (hidden[day] ?? 0) + 1;
      }
      continue;
    }
    laneEnds[lane] = candidate.to;
    segments.push({
      ...candidate,
      lane,
      continuesBefore: candidate.task.start < weekStart,
      continuesAfter: candidate.task.end > weekEnd,
    });
  }
  return { segments, hidden };
}
