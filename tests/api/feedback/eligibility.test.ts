import { describe, expect, it } from "vitest";
import {
  countActiveDay,
  type SurveyState,
  surveyGate,
  surveyTrigger,
} from "../../../apps/api/src/feedback/eligibility";
import type { FeedbackSettings } from "../../../apps/api/src/feedback/settings";

const now = new Date("2026-11-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

function settings(
  survey: Partial<FeedbackSettings["survey"]> = {},
  enabled = true,
): FeedbackSettings {
  return {
    enabled,
    survey: {
      enabled: true,
      format: "faces5",
      activeDays: 10,
      tasksCompleted: 10,
      intervalDays: 90,
      ...survey,
    },
  };
}

const fresh: SurveyState = {
  activeDays: 0,
  lastActiveOn: null,
  lastShownAt: null,
  snoozedUntil: null,
  optedOut: false,
};

function gate(
  state: Partial<SurveyState> = {},
  options: { settings?: FeedbackSettings; createdDaysAgo?: number } = {},
) {
  return surveyGate({
    settings: options.settings ?? settings(),
    state: { ...fresh, ...state },
    accountCreatedAt: daysAgo(options.createdDaysAgo ?? 30),
    now,
  });
}

describe("countActiveDay", () => {
  it("adds one day per UTC calendar day", () => {
    const first = countActiveDay(fresh, now);
    expect(first).toMatchObject({ activeDays: 1, lastActiveOn: "2026-11-13" });
    expect(countActiveDay(first, new Date("2026-11-13T23:59:00Z"))).toBe(first);
    expect(
      countActiveDay(first, new Date("2026-11-14T00:01:00Z")).activeDays,
    ).toBe(2);
  });
});

describe("surveyGate", () => {
  it("stays closed while feedback or the survey is off", () => {
    expect(gate({}, { settings: settings({ enabled: false }) })).toEqual({
      show: false,
      reason: "disabled",
    });
    expect(gate({}, { settings: settings({}, false) })).toEqual({
      show: false,
      reason: "disabled",
    });
  });

  it("never asks in an account's first 7 days", () => {
    expect(gate({}, { createdDaysAgo: 6 })).toEqual({
      show: false,
      reason: "newAccount",
    });
    expect(gate({}, { createdDaysAgo: 7 })).toBeNull();
  });

  it("respects Don't ask again and a running snooze", () => {
    expect(gate({ optedOut: true })).toMatchObject({ reason: "optedOut" });
    expect(gate({ snoozedUntil: new Date(now.getTime() + DAY) })).toMatchObject(
      { reason: "snoozed" },
    );
    expect(gate({ snoozedUntil: daysAgo(1) })).toBeNull();
  });

  it("waits the interval after the survey last asked", () => {
    expect(gate({ lastShownAt: daysAgo(89) })).toMatchObject({
      reason: "tooSoon",
    });
    expect(gate({ lastShownAt: daysAgo(90) })).toBeNull();
    expect(
      gate(
        { lastShownAt: daysAgo(40) },
        { settings: settings({ intervalDays: 30 }) },
      ),
    ).toBeNull();
  });
});

describe("surveyTrigger", () => {
  it("fires on completed tasks or active days, whichever comes first", () => {
    const s = settings();
    expect(
      surveyTrigger({ settings: s, activeDays: 3, tasksCompleted: 10 }),
    ).toEqual({ show: true, trigger: "tasksCompleted" });
    expect(
      surveyTrigger({ settings: s, activeDays: 10, tasksCompleted: 2 }),
    ).toEqual({ show: true, trigger: "activeDays" });
    expect(
      surveyTrigger({ settings: s, activeDays: 9, tasksCompleted: 9 }),
    ).toEqual({ show: false, reason: "notYet" });
  });

  it("treats a threshold of 0 as off", () => {
    const s = settings({ activeDays: 0, tasksCompleted: 0 });
    expect(
      surveyTrigger({ settings: s, activeDays: 500, tasksCompleted: 500 }),
    ).toEqual({ show: false, reason: "notYet" });
  });
});
