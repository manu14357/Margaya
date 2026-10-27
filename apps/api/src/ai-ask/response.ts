import { z } from "../openapi";

// Response pieces of Ask. Sources go out with the stream's `meta` event (and
// in the JSON body); `citations` and `noResults` come with `done`.

export const ASK_SOURCE_KINDS = ["task", "page", "comment", "web"] as const;

export const askSourceSchema = z
  .object({
    ref: z.string().openapi({
      description:
        "The citation token the answer uses inside square brackets: T:<task key> for a task, P:<page title> for a page, C:<task key>/<comment id prefix> for a comment, W:<n> for a web search result, D:<n> for a section of Margaya's documentation (kind web, linking to the docs site).",
      example: "T:WEB-12",
    }),
    kind: z.enum(ASK_SOURCE_KINDS),
    id: z.string(),
    title: z.string().openapi({
      description:
        "The task key and title, the page title, or the commented task.",
    }),
    url: z.string().openapi({
      description:
        "The web app path (opening it re-checks access); for a web result, its absolute http(s) URL.",
    }),
    projectId: z.string().nullable(),
    updatedAt: z.string().nullable().openapi({
      description:
        "When the source last changed (ISO 8601): the answer is as of then.",
    }),
  })
  .openapi("AskSource");

export type AskSource = z.infer<typeof askSourceSchema>;

export const askResponseExtra = {
  sources: z.array(askSourceSchema).openapi({
    description:
      "Everything the answer may cite, most relevant first. Only entities the caller can see and AI may read.",
  }),
  citations: z.array(z.string()).openapi({
    description:
      "The source refs the answer actually cites, in order of first use. Tokens that match no source are left out.",
  }),
  noResults: z.boolean().openapi({
    description:
      "True when nothing relevant was found: no model call was made and `text` is empty; show a 'nothing found' message.",
  }),
  asOf: z
    .string()
    .openapi({ description: "When the context was read (ISO 8601)." }),
  followUps: z.array(z.string()).openapi({
    description:
      "Zero to two short follow-up questions the person might ask next, in their language; empty unless a useful next step exists. Sent with `done`.",
  }),
};
