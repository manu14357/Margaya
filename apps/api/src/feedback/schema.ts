import { z } from "../openapi";
import {
  FEEDBACK_FEATURES,
  FEEDBACK_FORMATS,
  FEEDBACK_KINDS,
  FEEDBACK_PAGE_TYPES,
  isScoreInRange,
  MAX_FEEDBACK_COMMENT_CHARS,
} from "./constants";

export const submitFeedbackBody = z
  .strictObject({
    kind: z.enum(FEEDBACK_KINDS).openapi({
      description:
        "general from Send feedback, survey from the occasional survey card, feature from a thumbs prompt after a feature's first use.",
    }),
    format: z.enum(FEEDBACK_FORMATS).openapi({
      description:
        "The scale: faces3 (1-3), faces5 (1-5), stars (1-5), nps (0-10) or thumbs (0 down, 1 up). A survey answer must use the instance's survey format; a feature answer uses thumbs.",
    }),
    score: z.number().int().min(0).max(10).nullable().optional().openapi({
      description:
        "The rating on the format's scale. Optional for general feedback that carries a comment.",
    }),
    comment: z
      .string()
      .trim()
      .max(MAX_FEEDBACK_COMMENT_CHARS)
      .optional()
      .openapi({
        description: `What the person wants to say, at most ${MAX_FEEDBACK_COMMENT_CHARS} characters.`,
      }),
    pageType: z.enum(FEEDBACK_PAGE_TYPES).optional().openapi({
      description:
        "The kind of page it was sent from. Never an id, a name or a URL.",
    }),
    feature: z.enum(FEEDBACK_FEATURES).optional().openapi({
      description: "The rated feature; required for kind feature.",
    }),
    appVersion: z
      .string()
      .trim()
      .max(32)
      .regex(/^[0-9A-Za-z.+-]*$/)
      .optional()
      .openapi({ description: "The web app's version, e.g. 1.42.0." }),
    client: z.enum(["web", "desktop"]).optional().openapi({
      description: "desktop inside the desktop app, web otherwise.",
    }),
  })
  .superRefine((body, ctx) => {
    const score = body.score ?? null;
    if (score === null && !body.comment) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: "send a score, a comment or both",
      });
    }
    if (score !== null && !isScoreInRange(body.format, score)) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: `out of range for ${body.format}`,
      });
    }
    if (body.kind !== "general" && score === null) {
      ctx.addIssue({
        code: "custom",
        path: ["score"],
        message: "required",
      });
    }
    if (body.kind === "feature") {
      if (!body.feature) {
        ctx.addIssue({
          code: "custom",
          path: ["feature"],
          message: "required",
        });
      }
      if (body.format !== "thumbs") {
        ctx.addIssue({
          code: "custom",
          path: ["format"],
          message: "feature feedback uses thumbs",
        });
      }
    } else if (body.format === "thumbs") {
      ctx.addIssue({
        code: "custom",
        path: ["format"],
        message: "thumbs is for feature feedback",
      });
    }
  })
  .openapi("FeedbackRequest");

export type SubmitFeedbackBody = z.infer<typeof submitFeedbackBody>;

export const surveyPreferenceBody = z
  .strictObject({
    optedOut: z.boolean().openapi({
      description:
        "true stops the survey from ever asking this account (Don't ask again); false lets it ask again. Send feedback stays available either way.",
    }),
  })
  .openapi("FeedbackSurveyPreferenceRequest");

const days = z.coerce.number().int().min(1).max(3650).optional().openapi({
  description: "Only answers from the last N days.",
});

export const adminFeedbackFilterQuery = z.object({
  kind: z.enum(FEEDBACK_KINDS).optional(),
  format: z.enum(FEEDBACK_FORMATS).optional(),
  score: z.coerce.number().int().min(0).max(10).optional().openapi({
    description: "Only answers with this score.",
  }),
  hasComment: z.enum(["true", "false"]).optional().openapi({
    description: "true keeps answers with a comment.",
  }),
  search: z.string().trim().max(100).optional().openapi({
    description: "Matches the comment, or the person's name or email.",
  }),
  days,
});

export const listAdminFeedbackQuery = adminFeedbackFilterQuery.extend({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const adminFeedbackSummaryQuery = z.object({
  format: z.enum(FEEDBACK_FORMATS).optional().openapi({
    description: "The scale to summarise; defaults to the survey's format.",
  }),
  kind: z.enum(FEEDBACK_KINDS).optional(),
  days: z.coerce.number().int().min(7).max(3650).default(180).openapi({
    description: "The period, in days; 180 by default.",
  }),
});

export const feedbackIdParam = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .openapi({ param: { name: "id", in: "path" } }),
});

export const purgeFeedbackQuery = z.object({
  olderThanDays: z.coerce.number().int().min(0).max(3650).openapi({
    description: "Delete answers older than this many days; 0 deletes all.",
  }),
});

export type AdminFeedbackFilter = z.infer<typeof adminFeedbackFilterQuery>;
