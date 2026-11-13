// The product-feedback vocabulary shared by routes, controllers and tests.

export const FEEDBACK_KINDS = ["general", "survey", "feature"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_FORMATS = [
  "faces3",
  "faces5",
  "stars",
  "nps",
  "thumbs",
] as const;
export type FeedbackFormat = (typeof FEEDBACK_FORMATS)[number];

/** The scores each format accepts, inclusive. */
export const FORMAT_RANGES: Record<
  FeedbackFormat,
  { min: number; max: number }
> = {
  faces3: { min: 1, max: 3 },
  faces5: { min: 1, max: 5 },
  stars: { min: 1, max: 5 },
  nps: { min: 0, max: 10 },
  thumbs: { min: 0, max: 1 },
};

/**
 * Where in the app feedback was sent from: a coarse page type the web app
 * derives from its route, never an id, a name or a URL.
 */
export const FEEDBACK_PAGE_TYPES = [
  "home",
  "inbox",
  "my-work",
  "board",
  "list",
  "timeline",
  "calendar",
  "task",
  "cycles",
  "modules",
  "views",
  "intake",
  "pages",
  "analytics",
  "settings",
  "other",
] as const;
export type FeedbackPageType = (typeof FEEDBACK_PAGE_TYPES)[number];

/** Features that may ask for a thumbs up or down after their first use. */
export const FEEDBACK_FEATURES = [
  "cycles",
  "modules",
  "pages",
  "views",
  "intake",
  "analytics",
] as const;
export type FeedbackFeature = (typeof FEEDBACK_FEATURES)[number];

export const MAX_FEEDBACK_COMMENT_CHARS = 1000;

/** New accounts are never surveyed in their first week. */
export const SURVEY_MIN_ACCOUNT_AGE_DAYS = 7;
/** Closing the survey card puts it off for this long. */
export const SURVEY_SNOOZE_DAYS = 30;

export function isScoreInRange(format: FeedbackFormat, score: number) {
  const range = FORMAT_RANGES[format];
  return Number.isInteger(score) && score >= range.min && score <= range.max;
}
