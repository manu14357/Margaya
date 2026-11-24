import { z } from "../openapi";

// Response schemas of the whiteboard AI routes: proposals only. The editor
// shows them as a preview and writes nothing until the person accepts.

export const whiteboardAiIdeasSchema = z
  .object({
    title: z.string().openapi({
      description:
        "A short title for the ideas (the frame's name); may be empty.",
    }),
    ideas: z.array(z.string()).openapi({
      description:
        "The proposed sticky-note texts: distinct, one line each, at most the number asked for.",
    }),
  })
  .openapi("WhiteboardAiIdeas");

export const whiteboardAiGroupsSchema = z
  .object({
    groups: z
      .array(
        z.object({
          title: z.string().nullable().openapi({
            description:
              "The theme's title; null for the notes the model left out (shown as Other).",
          }),
          elementIds: z.array(z.string()).openapi({
            description: "The notes in this theme, by element id.",
          }),
        }),
      )
      .openapi({
        description:
          "Every requested note with text appears in exactly one group.",
      }),
  })
  .openapi("WhiteboardAiGroups");

export const whiteboardAiSummarySchema = z
  .object({
    title: z.string().openapi({ description: "A short title; may be empty." }),
    summary: z.string().openapi({
      description: 'Plain text, a few lines starting with "- ".',
    }),
    elementCount: z.number().int().openapi({
      description: "How many elements with text the summary was made from.",
    }),
  })
  .openapi("WhiteboardAiSummary");

export type WhiteboardAiIdeas = z.infer<typeof whiteboardAiIdeasSchema>;
export type WhiteboardAiGroups = z.infer<typeof whiteboardAiGroupsSchema>;
export type WhiteboardAiSummary = z.infer<typeof whiteboardAiSummarySchema>;
