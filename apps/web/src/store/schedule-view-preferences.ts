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
  /** The custom field Calendar and Gantt show on tasks, per project id. */
  scheduleFieldByProject: Record<string, string>;
  setScheduleField: (projectId: string, fieldId: string | null) => void;
};

export const SCHEDULE_VIEW_DEFAULTS = {
  calendarMode: "month",
  calendarShowWeekends: true,
  ganttZoom: "month",
} as const;

/**
 * Stored field choices, string ids only. A field deleted since reads as no
 * field where the choice is used, so stale ids need no cleanup here.
 */
export function normalizeScheduleFields(
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields: Record<string, string> = {};
  for (const [projectId, fieldId] of Object.entries(value)) {
    if (projectId && typeof fieldId === "string" && fieldId) {
      fields[projectId] = fieldId;
    }
  }
  return fields;
}

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
      // This browser only: the server syncs the keys of the defaults above.
      scheduleFieldByProject: {},
      setScheduleField: (projectId, fieldId) =>
        set((state) => {
          const { [projectId]: _previous, ...rest } =
            state.scheduleFieldByProject;
          return {
            scheduleFieldByProject: fieldId
              ? { ...rest, [projectId]: fieldId }
              : rest,
          };
        }),
    }),
    {
      name: "schedule-view-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: ({
        calendarMode,
        calendarShowWeekends,
        ganttZoom,
        scheduleFieldByProject,
      }) => ({
        calendarMode,
        calendarShowWeekends,
        ganttZoom,
        scheduleFieldByProject,
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
          scheduleFieldByProject: normalizeScheduleFields(
            stored.scheduleFieldByProject,
          ),
        };
      },
    },
  ),
);
