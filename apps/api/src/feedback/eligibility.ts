import { SURVEY_MIN_ACCOUNT_AGE_DAYS } from "./constants";
import type { FeedbackSettings } from "./settings";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SurveyState = {
  activeDays: number;
  lastActiveOn: string | null;
  lastShownAt: Date | null;
  snoozedUntil: Date | null;
  optedOut: boolean;
};

export type SurveyTrigger = "activeDays" | "tasksCompleted";

export type SurveyDecision =
  | { show: true; trigger: SurveyTrigger }
  | {
      show: false;
      reason:
        | "disabled"
        | "optedOut"
        | "newAccount"
        | "snoozed"
        | "tooSoon"
        | "notYet";
    };

/** The UTC calendar day, YYYY-MM-DD: one active day per day the app opens. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The state after today's visit: a new day adds one active day. */
export function countActiveDay(state: SurveyState, now: Date): SurveyState {
  const today = utcDay(now);
  if (state.lastActiveOn === today) return state;
  return { ...state, activeDays: state.activeDays + 1, lastActiveOn: today };
}

/**
 * The guards that hold before any trigger is counted: the survey is on, the
 * person has not opted out, their account is past its first week, no snooze
 * runs, and the interval since the survey last asked has passed.
 */
export function surveyGate(input: {
  settings: FeedbackSettings;
  state: SurveyState;
  accountCreatedAt: Date;
  now: Date;
}): SurveyDecision | null {
  const { settings, state, accountCreatedAt, now } = input;
  if (!settings.enabled || !settings.survey.enabled) {
    return { show: false, reason: "disabled" };
  }
  if (state.optedOut) return { show: false, reason: "optedOut" };
  if (
    now.getTime() - accountCreatedAt.getTime() <
    SURVEY_MIN_ACCOUNT_AGE_DAYS * DAY_MS
  ) {
    return { show: false, reason: "newAccount" };
  }
  if (state.snoozedUntil && state.snoozedUntil.getTime() > now.getTime()) {
    return { show: false, reason: "snoozed" };
  }
  if (
    state.lastShownAt &&
    now.getTime() - state.lastShownAt.getTime() <
      settings.survey.intervalDays * DAY_MS
  ) {
    return { show: false, reason: "tooSoon" };
  }
  return null;
}

/** Whether a trigger has fired once the gate is open. */
export function surveyTrigger(input: {
  settings: FeedbackSettings;
  activeDays: number;
  tasksCompleted: number;
}): SurveyDecision {
  const { activeDays, tasksCompleted } = input.settings.survey;
  if (tasksCompleted > 0 && input.tasksCompleted >= tasksCompleted) {
    return { show: true, trigger: "tasksCompleted" };
  }
  if (activeDays > 0 && input.activeDays >= activeDays) {
    return { show: true, trigger: "activeDays" };
  }
  return { show: false, reason: "notYet" };
}
