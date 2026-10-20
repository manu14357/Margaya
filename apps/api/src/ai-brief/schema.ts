import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";
import { BRIEF_AUDIENCES, BRIEF_SCOPE_TYPES } from "./types";

// Request schemas of the stakeholder brief routes (ai-brief/index.ts).

export const generateBriefBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    scopeType: z.enum(BRIEF_SCOPE_TYPES).openapi({
      description: "What the brief is about.",
    }),
    scopeId: z.string().min(1).openapi({
      description: "The cycle, module or project ID.",
    }),
    audience: z.enum(BRIEF_AUDIENCES).default("team").openapi({
      description:
        "team: concrete; leadership: outcomes and risks first; client: customer-safe (no people, no internal process; not for restricted projects).",
    }),
    locale: answerLocale,
  })
  .openapi("AiBriefInput");

export const briefIdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: "id", in: "path" },
      description: "Brief ID (from the generate response).",
    }),
});

export const shareBriefBody = z
  .strictObject({
    pageId: z.string().min(1).nullable().optional().openapi({
      description:
        "The Page the brief was saved as (same project). Omit when it was copied.",
    }),
  })
  .openapi("AiBriefShareInput");
