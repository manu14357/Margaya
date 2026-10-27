import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const CALENDAR_MODES = ["month", "week"] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export const GANTT_ZOOMS = ["week", "month", "quarter"] as const;
export type GanttZoom = (typeof GANTT_ZOOMS)[number];

type ScheduleViewPreferences = {
  calendarMode: CalendarMode;
  setCalendarMode: (mode: CalendarMode) => void;
  calendarShowWeekends: boolean;
  setCalendarShowWeekends: (show: boolean) => void;
  ganttZoom: GanttZoom;
  setGanttZoom: (zoom: GanttZoom) => void;
};

export const SCHEDULE_VIEW_DEFAULTS = {
  calendarMode: "month",
  calendarShowWeekends: true,
  ganttZoom: "month",
} as const;

/**
 * Calendar and timeline display choices, kept per browser like the other
 * display preferences. Stored values are checked on load so an old or
 * hand-edited entry falls back to the defaults instead of breaking a view.
 */
export const useScheduleViewPreferences = create<ScheduleViewPreferences>()(
  persist(
    (set) => ({
      ...SCHEDULE_VIEW_DEFAULTS,
      setCalendarMode: (calendarMode) => set({ calendarMode }),
      setCalendarShowWeekends: (calendarShowWeekends) =>
        set({ calendarShowWeekends }),
      setGanttZoom: (ganttZoom) => set({ ganttZoom }),
    }),
    {
      name: "schedule-view-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ calendarMode, calendarShowWeekends, ganttZoom }) => ({
        calendarMode,
        calendarShowWeekends,
        ganttZoom,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<ScheduleViewPreferences>;
        return {
          ...current,
          calendarMode: CALENDAR_MODES.includes(stored.calendarMode as never)
            ? (stored.calendarMode as CalendarMode)
            : SCHEDULE_VIEW_DEFAULTS.calendarMode,
          calendarShowWeekends:
            typeof stored.calendarShowWeekends === "boolean"
              ? stored.calendarShowWeekends
              : SCHEDULE_VIEW_DEFAULTS.calendarShowWeekends,
          ganttZoom: GANTT_ZOOMS.includes(stored.ganttZoom as never)
            ? (stored.ganttZoom as GanttZoom)
            : SCHEDULE_VIEW_DEFAULTS.ganttZoom,
        };
      },
    },
  ),
);
