import { z } from "../openapi";
import { TRANSLATE_KINDS } from "./schema";

// Response schema of the translate-on-read route (ai-translate/index.ts).

export const translationSchema = z
  .object({
    kind: z.enum(TRANSLATE_KINDS),
    id: z.string(),
    targetLocale: z.string(),
    status: z.enum(["translated", "same_language"]).openapi({
      description:
        "same_language: the content is already in the reader's language; text is null.",
    }),
    sourceLanguage: z.string().nullable().openapi({
      description: "ISO 639-1 code of the original, when it could be told.",
    }),
    text: z.string().nullable().openapi({
      description: "The translation (Markdown for comments and descriptions).",
    }),
    cached: z.boolean().openapi({
      description:
        "Served from the cache: the same text was translated for this language before.",
    }),
  })
  .openapi("AiTranslation");
