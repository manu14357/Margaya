import { beforeEach, describe, expect, it } from "vitest";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import {
  DEFAULT_USER_PREFERENCES,
  useUserPreferencesStore,
} from "@/store/user-preferences";
import {
  applyServerPreferences,
  changedPreferences,
  chosenPreferences,
  currentPreferences,
} from "./preferences-sync";

beforeEach(() => {
  localStorage.clear();
  useUserPreferencesStore.setState({ ...DEFAULT_USER_PREFERENCES });
  useScheduleViewPreferences.setState({
    calendarMode: "month",
    calendarShowWeekends: true,
    ganttZoom: "month",
  });
});

describe("preferences sync helpers", () => {
  it("seeds only values chosen away from the defaults", () => {
    useUserPreferencesStore.setState({ weekStartsOn: 1, showLabels: false });
    useScheduleViewPreferences.setState({ ganttZoom: "week" });
    expect(chosenPreferences(currentPreferences())).toEqual({
      weekStartsOn: 1,
      showLabels: false,
      ganttZoom: "week",
    });
  });

  it("never seeds the light theme a user did not pick", () => {
    expect(chosenPreferences(currentPreferences())).toEqual({});
  });

  it("lists changed keys only", () => {
    expect(
      changedPreferences(
        { theme: "light", showLabels: true },
        { theme: "dark-contrast", showLabels: true },
        ["theme", "showLabels"],
      ),
    ).toEqual({ theme: "dark-contrast" });
  });

  it("applies server values except keys still being saved", () => {
    useUserPreferencesStore.setState({ showDueDates: false });
    applyServerPreferences(
      {
        theme: "dark",
        showDueDates: true,
        pagesFormatToolbar: false,
        calendarMode: "week",
      },
      new Set(["showDueDates"]),
    );
    const state = useUserPreferencesStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.pagesFormatToolbar).toBe(false);
    expect(state.showDueDates).toBe(false);
    expect(useScheduleViewPreferences.getState().calendarMode).toBe("week");
  });
});
