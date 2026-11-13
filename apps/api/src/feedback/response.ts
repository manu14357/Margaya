import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import {
  FEEDBACK_FEATURES,
  FEEDBACK_FORMATS,
  FEEDBACK_KINDS,
  FEEDBACK_PAGE_TYPES,
} from "./constants";

const surveyFormat = z.enum(["faces3", "faces5", "stars", "nps"]);

export const feedbackConfigSchema = z
  .object({
    enabled: z.boolean().openapi({
      description: "Send feedback is available on this instance.",
    }),
    survey: z.object({
      enabled: z.boolean().openapi({
        description:
          "The instance runs the occasional survey (it still asks only when this account is eligible).",
      }),
      format: surveyFormat,
      optedOut: z.boolean().openapi({
        description: "This account chose Don't ask again.",
      }),
    }),
  })
  .openapi("FeedbackConfig");

export const feedbackCreatedSchema = z
  .object({ id: z.string() })
  .openapi("FeedbackCreated");

export const surveyCheckSchema = z
  .object({
    show: z.boolean().openapi({
      description:
        "true: show the survey card now. The server counts it as asked, so it won't ask again until the interval passes.",
    }),
    format: surveyFormat,
  })
  .openapi("FeedbackSurveyCheck");

export const surveyStateSchema = z
  .object({
    optedOut: z.boolean(),
    snoozedUntil: nullableResponseTimestamp,
  })
  .openapi("FeedbackSurveyState");

const feedbackFields = {
  id: z.string(),
  kind: z.enum(FEEDBACK_KINDS),
  format: z.enum(FEEDBACK_FORMATS),
  score: z.number().int().nullable(),
  comment: z.string().nullable(),
  pageType: z.enum(FEEDBACK_PAGE_TYPES).nullable(),
  feature: z.enum(FEEDBACK_FEATURES).nullable(),
  appVersion: z.string().nullable(),
  client: z.enum(["web", "desktop"]).nullable(),
  createdAt: responseTimestamp,
};

export const ownFeedbackSchema = z
  .object(feedbackFields)
  .openapi("OwnFeedback");

export const ownFeedbackListSchema = z
  .object({ items: z.array(ownFeedbackSchema) })
  .openapi("OwnFeedbackList");

export const deletedFeedbackSchema = z
  .object({ deleted: z.number().int() })
  .openapi("FeedbackDeleted");

export const adminFeedbackSchema = z
  .object({
    ...feedbackFields,
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  })
  .openapi("AdminFeedback");

export const adminFeedbackPageSchema = z
  .object({
    items: z.array(adminFeedbackSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("AdminFeedbackPage");

const scoreSummary = {
  count: z.number().int(),
  average: z.number().nullable(),
  satisfaction: z.number().int().nullable().openapi({
    description:
      "Share of happy answers, 0-100: the top face of three, 4-5 of five faces or stars, 9-10 on NPS, thumbs up.",
  }),
  nps: z.number().int().nullable().openapi({
    description: "Promoters minus detractors, -100 to 100. NPS only.",
  }),
};

export const adminFeedbackSummarySchema = z
  .object({
    format: z.enum(FEEDBACK_FORMATS),
    days: z.number().int(),
    ...scoreSummary,
    total: z.number().int().openapi({
      description: "Every answer in the period, on any scale.",
    }),
    comments: z.number().int().openapi({
      description: "Answers in the period with a comment.",
    }),
    byKind: z.object({
      general: z.number().int(),
      survey: z.number().int(),
      feature: z.number().int(),
    }),
    distribution: z.array(
      z.object({ score: z.number().int(), count: z.number().int() }),
    ),
    trend: z.array(
      z.object({
        week: z.string().openapi({ description: "Monday, YYYY-MM-DD (UTC)." }),
        ...scoreSummary,
      }),
    ),
  })
  .openapi("AdminFeedbackSummary");
