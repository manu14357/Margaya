import type { FEEDBACK_SURVEY_FORMATS } from "../instance-settings/catalog";
import { getInstanceSettings } from "../instance-settings/snapshot";

export type SurveyFormat = (typeof FEEDBACK_SURVEY_FORMATS)[number];

export type FeedbackSettings = {
  enabled: boolean;
  survey: {
    enabled: boolean;
    format: SurveyFormat;
    /** 0 turns the trigger off. */
    activeDays: number;
    tasksCompleted: number;
    intervalDays: number;
  };
};

/** The effective feedback settings (catalog group "feedback"). */
export function getFeedbackSettings(): FeedbackSettings {
  const { settings } = getInstanceSettings();
  const value = (key: string) => settings[key]?.value;
  const number = (key: string, fallback: number) => {
    const raw = value(key);
    return typeof raw === "number" ? raw : fallback;
  };
  const format = value("feedback.survey.format");
  return {
    enabled: value("feedback.enabled") !== false,
    survey: {
      enabled: value("feedback.survey.enabled") === true,
      format:
        format === "faces3" || format === "stars" || format === "nps"
          ? format
          : "faces5",
      activeDays: number("feedback.survey.activeDays", 10),
      tasksCompleted: number("feedback.survey.tasksCompleted", 10),
      intervalDays: number("feedback.survey.intervalDays", 90),
    },
  };
}
