import { z } from "../openapi";

// Request bodies of the AI writing routes (B6): editor block actions,
// one-click summaries and first-draft specs.

/** The 20 UI languages: answers and translations target one of them. */
export const UI_LOCALES = [
  "az-AZ",
  "de-DE",
  "el-GR",
  "en-US",
  "es-ES",
  "fr-FR",
  "hi-IN",
  "id-ID",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "mk-MK",
  "nl-NL",
  "pl-PL",
  "pt-BR",
  "ru-RU",
  "tr-TR",
  "uk-UA",
  "vi-VN",
  "zh-CN",
] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const EDITOR_ACTIONS = [
  "summarize",
  "improve",
  "shorter",
  "longer",
  "fix",
  "translate",
  "custom",
  "draft",
] as const;
export type EditorAction = (typeof EDITOR_ACTIONS)[number];

/** Tone presets for rewrites (improve, shorter, longer, custom, draft). */
export const EDITOR_TONES = ["default", "professional", "casual"] as const;
export type EditorTone = (typeof EDITOR_TONES)[number];

/** At most this much selected text per request. */
export const MAX_SELECTION_CHARS = 20_000;
/** At most this much of a page's live content per AI block or title. */
export const MAX_PAGE_CHARS = 60_000;

export const PAGE_BLOCK_PRESETS = [
  "tldr",
  "faq",
  "action_items",
  "custom",
] as const;
export type PageBlockPreset = (typeof PAGE_BLOCK_PRESETS)[number];

const workspaceId = z.string().min(1).openapi({
  description: "The workspace the content belongs to.",
});

const locale = z.enum(UI_LOCALES).optional().openapi({
  description:
    "The caller's UI language; the answer is written in it. Defaults to the language saved in the caller's profile.",
});

export const editorAssistBody = z
  .object({
    workspaceId,
    target: z
      .object({
        kind: z.enum(["page", "task", "new_task", "comment_draft"]),
        id: z.string().min(1),
      })
      .openapi({
        description:
          "The page or task description being edited, which the caller must be able to see and edit; new_task with a project id for a task still being created (needs task:create there); or comment_draft with the id of the task a comment is being written on (needs the right to comment there, task:update).",
      }),
    action: z.enum(EDITOR_ACTIONS).openapi({
      description:
        "summarize, improve (writing), shorter, longer, fix (spelling and grammar), translate (needs language), custom (needs instruction) or draft (write a task description from its title and notes).",
    }),
    text: z.string().trim().min(1).max(MAX_SELECTION_CHARS).openapi({
      description: "The selected text or block, as Markdown.",
    }),
    language: z.enum(UI_LOCALES).optional().openapi({
      description: "translate: the language to translate into.",
    }),
    instruction: z.string().trim().min(1).max(500).optional().openapi({
      description: "custom: what to do with the text, in the caller's words.",
    }),
    tone: z.enum(EDITOR_TONES).optional().openapi({
      description:
        "Tone of the rewrite for improve, shorter, longer, custom and draft: default (keep the passage's tone), professional or casual. Ignored by the other actions.",
    }),
    locale,
  })
  .refine((body) => body.action !== "translate" || Boolean(body.language), {
    message: "language is required to translate",
    path: ["language"],
  })
  .refine((body) => body.action !== "custom" || Boolean(body.instruction), {
    message: "instruction is required for a custom action",
    path: ["instruction"],
  })
  .openapi("AiEditorAssistBody");

export const summarizeBody = z
  .object({
    workspaceId,
    kind: z.enum(["cycle", "project", "page", "task"]).openapi({
      description:
        "cycle: progress, risks and notable changes; project: status and health; page: a TL;DR; task: where a task stands, from its description, comments and history.",
    }),
    id: z
      .string()
      .min(1)
      .openapi({ description: "The cycle, project, page or task." }),
    locale,
  })
  .openapi("AiSummarizeBody");

export const specDraftBody = z
  .object({
    workspaceId,
    taskId: z.string().min(1).openapi({
      description: "The task the spec is drafted from.",
    }),
    locale,
  })
  .openapi("AiSpecDraftBody");

const pageText = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PAGE_CHARS)
  .optional()
  .openapi({
    description:
      "The page's current content as Markdown, as the editor shows it (live edits may not be saved yet). Defaults to the saved content.",
  });

export const pageTitleBody = z
  .object({
    workspaceId,
    pageId: z.string().min(1).openapi({ description: "The page to title." }),
    text: pageText,
    locale,
  })
  .openapi("AiPageTitleBody");

export const pageBlockBody = z
  .object({
    workspaceId,
    pageId: z.string().min(1).openapi({
      description: "The page the block is generated from and inserted into.",
    }),
    preset: z.enum(PAGE_BLOCK_PRESETS).openapi({
      description:
        "tldr (a short summary), faq (questions and answers the page answers), action_items (a task list of follow-ups) or custom (needs instruction).",
    }),
    instruction: z.string().trim().min(1).max(500).optional().openapi({
      description: "custom: what to generate from the page.",
    }),
    text: pageText,
    locale,
  })
  .refine((body) => body.preset !== "custom" || Boolean(body.instruction), {
    message: "instruction is required for a custom block",
    path: ["instruction"],
  })
  .openapi("AiPageBlockBody");

export type EditorAssistInput = z.infer<typeof editorAssistBody>;
export type SummarizeInput = z.infer<typeof summarizeBody>;
export type SpecDraftInput = z.infer<typeof specDraftBody>;
export type PageBlockInput = z.infer<typeof pageBlockBody>;
