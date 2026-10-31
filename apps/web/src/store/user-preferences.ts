import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_NOTIFICATION_SOUND,
  type NotificationSoundSettings,
  normalizeNotificationSound,
} from "@/lib/notification-sound/settings";
import type { SidebarLayout } from "@/lib/sidebar-layout";

export const WEEK_START_DAYS = [0, 1, 6] as const;
export type WeekStartDay = (typeof WEEK_START_DAYS)[number];

export function isWeekStartDay(value: number): value is WeekStartDay {
  return WEEK_START_DAYS.some((day) => day === value);
}

/** Theme choices; the contrast themes are high-contrast light and dark. */
export const THEMES = [
  "light",
  "dark",
  "system",
  "light-contrast",
  "dark-contrast",
] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

export const ACTIVITY_FILTERS = [
  "all",
  "comments",
  "updates",
  // What AI agents did (eventData.via).
  "agents",
] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
export const ACTIVITY_SORTS = ["newest", "oldest"] as const;
export type ActivitySort = (typeof ACTIVITY_SORTS)[number];

type UserPreferencesStore = {
  theme: Theme;
  setTheme: (theme: Theme, coordinates?: { x: number; y: number }) => void;

  viewMode: "board" | "list";
  setViewMode: (mode: "board" | "list") => void;

  showTaskNumbers: boolean;
  setShowTaskNumbers: (show: boolean) => void;
  toggleTaskNumbers: () => void;
  showAssignees: boolean;
  setShowAssignees: (show: boolean) => void;
  toggleAssignees: () => void;
  showDueDates: boolean;
  setShowDueDates: (show: boolean) => void;
  toggleDueDates: () => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  toggleLabels: () => void;
  showPriority: boolean;
  setShowPriority: (show: boolean) => void;
  togglePriority: () => void;
  showEstimates: boolean;
  setShowEstimates: (show: boolean) => void;
  toggleEstimates: () => void;
  showTaskItemCounts: boolean;
  setShowTaskItemCounts: (show: boolean) => void;
  toggleTaskItemCounts: () => void;
  resetDisplayPreferences: () => void;

  sidebarDefaultOpen: boolean;
  setSidebarDefaultOpen: (open: boolean) => void;

  /** The user's rail and Projects panel order and hidden items; null is the default. */
  sidebarLayout: SidebarLayout | null;
  setSidebarLayout: (layout: SidebarLayout | null) => void;

  weekStartsOn: WeekStartDay;
  setWeekStartsOn: (weekStartsOn: WeekStartDay) => void;

  /** The task activity feed: what it shows, and in which order. */
  activityFilter: ActivityFilter;
  setActivityFilter: (filter: ActivityFilter) => void;
  activitySort: ActivitySort;
  setActivitySort: (sort: ActivitySort) => void;

  /** The fixed formatting toolbar above an editable page. */
  pagesFormatToolbar: boolean;
  setPagesFormatToolbar: (show: boolean) => void;

  /** Sounds for in-app notifications. */
  notificationSound: NotificationSoundSettings;
  setNotificationSound: (changes: Partial<NotificationSoundSettings>) => void;

  /**
   * The account time zone (IANA), cached from the server; null until known
   * or when never chosen. Task queries prefer it over the browser's zone.
   */
  timeZone: string | null;
  setTimeZone: (timeZone: string | null) => void;
};

/** Defaults of the preferences the server keeps per user. */
export const DEFAULT_USER_PREFERENCES = {
  // New visitors start light, and so does anyone who never chose a theme.
  theme: "light" as Theme,
  viewMode: "board" as "board" | "list",
  showTaskNumbers: true,
  showAssignees: true,
  showDueDates: true,
  showLabels: true,
  showPriority: true,
  showEstimates: true,
  showTaskItemCounts: true,
  sidebarDefaultOpen: true,
  sidebarLayout: null as SidebarLayout | null,
  weekStartsOn: 0 as WeekStartDay,
  activityFilter: "all" as ActivityFilter,
  activitySort: "newest" as ActivitySort,
  pagesFormatToolbar: true,
  notificationSound: DEFAULT_NOTIFICATION_SOUND,
};

export const useUserPreferencesStore = create<UserPreferencesStore>()(
  persist(
    (set) => ({
      // New visitors start light; a saved choice is restored by `persist`.
      theme: DEFAULT_USER_PREFERENCES.theme,
      setTheme: (theme: Theme, coordinates?: { x: number; y: number }) => {
        if (coordinates) {
          document.documentElement.style.setProperty(
            "--x",
            `${coordinates.x}%`,
          );
          document.documentElement.style.setProperty(
            "--y",
            `${coordinates.y}%`,
          );
        } else {
          document.documentElement.style.removeProperty("--x");
          document.documentElement.style.removeProperty("--y");
        }

        if ("startViewTransition" in document) {
          document.startViewTransition(() => {
            set({ theme });
          });
        } else {
          set({ theme });
        }
      },

      viewMode: "board",
      setViewMode: (mode) => set({ viewMode: mode }),

      showTaskNumbers: true,
      setShowTaskNumbers: (show) => set({ showTaskNumbers: show }),
      toggleTaskNumbers: () =>
        set((state) => ({ showTaskNumbers: !state.showTaskNumbers })),
      showAssignees: true,
      setShowAssignees: (show) => set({ showAssignees: show }),
      toggleAssignees: () =>
        set((state) => ({ showAssignees: !state.showAssignees })),
      showDueDates: true,
      setShowDueDates: (show) => set({ showDueDates: show }),
      toggleDueDates: () =>
        set((state) => ({ showDueDates: !state.showDueDates })),
      showLabels: true,
      setShowLabels: (show) => set({ showLabels: show }),
      toggleLabels: () => set((state) => ({ showLabels: !state.showLabels })),
      showPriority: true,
      setShowPriority: (show) => set({ showPriority: show }),
      togglePriority: () =>
        set((state) => ({ showPriority: !state.showPriority })),
      showEstimates: true,
      setShowEstimates: (show) => set({ showEstimates: show }),
      toggleEstimates: () =>
        set((state) => ({ showEstimates: !state.showEstimates })),
      showTaskItemCounts: true,
      setShowTaskItemCounts: (show) => set({ showTaskItemCounts: show }),
      toggleTaskItemCounts: () =>
        set((state) => ({ showTaskItemCounts: !state.showTaskItemCounts })),
      resetDisplayPreferences: () =>
        set({
          showAssignees: true,
          showDueDates: true,
          showLabels: true,
          showTaskNumbers: true,
          showPriority: true,
          showEstimates: true,
          showTaskItemCounts: true,
        }),

      sidebarDefaultOpen: true,
      setSidebarDefaultOpen: (open) => set({ sidebarDefaultOpen: open }),

      sidebarLayout: null,
      setSidebarLayout: (sidebarLayout) => set({ sidebarLayout }),

      weekStartsOn: 0,
      setWeekStartsOn: (weekStartsOn) => set({ weekStartsOn }),

      activityFilter: "all",
      setActivityFilter: (activityFilter) => set({ activityFilter }),
      activitySort: "newest",
      setActivitySort: (activitySort) => set({ activitySort }),

      pagesFormatToolbar: true,
      setPagesFormatToolbar: (pagesFormatToolbar) =>
        set({ pagesFormatToolbar }),

      notificationSound: DEFAULT_USER_PREFERENCES.notificationSound,
      // A new object on every change, so the server sync sees it.
      setNotificationSound: (changes) =>
        set((state) => ({
          notificationSound: normalizeNotificationSound({
            ...state.notificationSound,
            ...changes,
          }),
        })),

      timeZone: null,
      setTimeZone: (timeZone) => set({ timeZone }),
    }),
    {
      name: "user-preferences",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state && !isTheme(state.theme)) {
          state.setTheme(DEFAULT_USER_PREFERENCES.theme);
        }
        if (state && !isWeekStartDay(state.weekStartsOn)) {
          state.setWeekStartsOn(0);
        }
        if (state && !ACTIVITY_FILTERS.includes(state.activityFilter)) {
          state.setActivityFilter("all");
        }
        if (state && !ACTIVITY_SORTS.includes(state.activitySort)) {
          state.setActivitySort("newest");
        }
        if (state) {
          state.setNotificationSound(
            normalizeNotificationSound(state.notificationSound),
          );
        }
      },
    },
  ),
);
