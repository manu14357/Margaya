import { aiAssistInput } from "../ai/provenance";
import { z } from "../openapi";
import { REACTION_EMOJI } from "../reaction/emoji";
import { SECTION_MAX, SUMMARY_MAX } from "./draft";
import { PROJECT_UPDATE_HEALTHS } from "./types";

export const COMMENT_MAX = 5000;
export const LIST_LIMIT_MAX = 50;

export const projectIdParam = z.object({
  projectId: z.string().min(1).openapi({ description: "The project's id." }),
});

export const updateIdParam = z.object({
  id: z.string().min(1).openapi({ description: "The update's id." }),
});

export const commentIdParam = z.object({
  commentId: z.string().min(1).openapi({ description: "The comment's id." }),
});

export const workspaceIdParam = z.object({
  workspaceId: z
    .string()
    .min(1)
    .openapi({ description: "The workspace's id." }),
});

export const listUpdatesQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIST_LIMIT_MAX)
    .optional()
    .openapi({
      description: `Page size, 1 to ${LIST_LIMIT_MAX} (default 20).`,
    }),
  cursor: z.string().min(1).optional().openapi({
    description: "The `nextCursor` of the previous page.",
  }),
});

const health = z.enum(PROJECT_UPDATE_HEALTHS).openapi({
  description: "on_track, at_risk or off_track.",
});

const section = (description: string) =>
  z
    .string()
    .trim()
    .max(SECTION_MAX)
    .nullable()
    .optional()
    .openapi({
      description: `${description} Markdown, up to ${SECTION_MAX} characters; null or empty clears it.`,
    });

export const createUpdateBody = z.object({
  health,
  summary: z
    .string()
    .trim()
    .min(1)
    .max(SUMMARY_MAX)
    .openapi({
      description: `A short summary, up to ${SUMMARY_MAX} characters.`,
    }),
  highlights: section("What went well or was completed."),
  blockers: section("What is blocked, late or at risk."),
  nextSteps: section("What happens next."),
  aiAssist: aiAssistInput,
});

export const patchUpdateBody = z
  .object({
    health: health.optional(),
    summary: z.string().trim().min(1).max(SUMMARY_MAX).optional(),
    highlights: section("What went well or was completed."),
    blockers: section("What is blocked, late or at risk."),
    nextSteps: section("What happens next."),
  })
  .openapi({ minProperties: 1 });

export const draftUpdateBody = z.object({
  useAi: z.boolean().optional().openapi({
    description:
      "Ask the model to write the draft (default true). Without AI available the template draft is returned and `aiUnavailable` says why.",
  }),
  locale: z.string().min(2).max(35).optional().openapi({
    description: "Answer language for the AI draft; defaults to the user's.",
  }),
});

export const createCommentBody = z.object({
  content: z.string().trim().min(1).max(COMMENT_MAX),
});

export const reactionParam = z.object({
  id: z.string().min(1).openapi({ description: "The update's id." }),
  emoji: z.enum(REACTION_EMOJI).openapi({
    description: `The reaction key, one of: ${REACTION_EMOJI.join(", ")}.`,
  }),
});

export const followBody = z.object({
  following: z.boolean(),
});

export const reminderBody = z.object({
  enabled: z.boolean(),
  weekday: z.number().int().min(0).max(6).optional().openapi({
    description:
      "0 = Sunday ... 6 = Saturday, in the workspace's time zone (default 5, Friday).",
  }),
});
