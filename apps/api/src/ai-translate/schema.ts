import { z } from "../openapi";

// Request schemas of the translate-on-read route (ai-translate/index.ts).

/** A BCP 47 language tag such as de-DE. */
export const localeTag = z
  .string()
  .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/, "use a BCP 47 tag")
  .max(35);

/** The caller's UI language for AI answers (default: their profile's). */
export const answerLocale = localeTag.optional().openapi({
  description:
    "The caller's UI language; the answer is written in it. Defaults to the language saved in the caller's profile.",
});

export const TRANSLATE_KINDS = ["comment", "task", "page"] as const;
export type TranslateKind = (typeof TRANSLATE_KINDS)[number];

export const translateBody = z
  .strictObject({
    workspaceId: z.string().min(1).openapi({ description: "Workspace ID" }),
    kind: z.enum(TRANSLATE_KINDS).openapi({
      description:
        "What to translate: a comment, a task's description or a page's content.",
    }),
    id: z.string().min(1).openapi({
      description: "The comment (activity), task or page ID.",
    }),
    targetLocale: localeTag.optional().openapi({
      description:
        "The reader's language, such as de-DE. Default: the language saved in the caller's profile.",
    }),
  })
  .openapi("AiTranslateInput");
