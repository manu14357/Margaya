import { z } from "../openapi";

// Request schemas of the AI routes (ai/index.ts).

const workspaceId = z.string().min(1).openapi({ description: "Workspace ID" });

export const aiAvailabilityQuery = z.object({
  workspaceId,
  projectId: z.string().min(1).optional().openapi({
    description: "Also answer for this project's AI switch.",
  }),
});

export const aiWorkspaceQuery = z.object({ workspaceId });

const MAX_CAP_MICROS = 1_000_000_000_000; // one million dollars
const MAX_DAILY_TOKENS = 1_000_000_000;

export const updateAiSettingsBody = z
  .strictObject({
    workspaceId,
    enabled: z.boolean().optional().openapi({
      description: "Opt the workspace in to AI (the instance must allow it).",
    }),
    monthlyCapMicros: z
      .number()
      .int()
      .min(0)
      .max(MAX_CAP_MICROS)
      .nullable()
      .optional()
      .openapi({
        description:
          "Monthly spend cap in micro-dollars (1,000,000 = $1) by list price; null removes it. Calls are refused with AI_BUDGET_EXCEEDED once reached.",
      }),
    userDailyCapTokens: z
      .number()
      .int()
      .min(0)
      .max(MAX_DAILY_TOKENS)
      .nullable()
      .optional()
      .openapi({
        description:
          "Tokens (input plus output) each person may use per UTC day; null removes the cap.",
      }),
    requireApprovalForWrites: z.boolean().optional().openapi({
      description: "AI changes always wait for a person's approval.",
    }),
    includeRestricted: z.boolean().optional().openapi({
      description:
        "Let AI read restricted projects (for people who can see them). Their data then only goes where the instance allows restricted data.",
    }),
    localOnly: z.boolean().optional().openapi({
      description: "Send every AI call to the instance's local model.",
    }),
    redactPii: z.boolean().optional().openapi({
      description:
        "Replace emails, phone numbers, card numbers and tokens with placeholders before cloud calls.",
    }),
    autoTranslateComments: z.boolean().optional().openapi({
      description:
        "Translate comments written in another language for each reader without a click. Off by default; translations are cached per comment and language.",
    }),
    embeddingsEnabled: z.boolean().optional().openapi({
      description:
        "Semantic search: embed tasks, pages and comments so Ask and the duplicate check also find work by meaning, not only by words. Needs the server's embeddings endpoint and pgvector on its database (409 otherwise). Turning it off deletes the workspace's embeddings; full-text search always keeps working.",
    }),
    webSearchEnabled: z.boolean().optional().openapi({
      description:
        "Let Ask search the web when someone turns it on for a question. Only the question is sent to the instance's search provider, never workspace content. Works only when the instance has a search provider.",
    }),
    storeConversations: z.boolean().optional().openapi({
      description:
        "Keep Ask conversations on the server so people can reopen, rename and pin them on any device. Off by default: conversations then stay in the browser. While off, stored conversations are neither listed nor written.",
    }),
    allowAutopilot: z.boolean().optional().openapi({
      description:
        "Let chat apply AI-proposed changes without a review step. Changes are still recorded and can be undone.",
    }),
    key: z
      .object({
        provider: z.enum(["anthropic", "openai_compatible"]),
        apiKey: z.string().trim().min(8).max(512),
      })
      .nullable()
      .optional()
      .openapi({
        description:
          "The workspace's own provider key, sealed on the server and never returned; null removes it. Only when the instance allows workspace keys.",
      }),
  })
  .openapi("UpdateAiSettings");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .optional();

export const aiUsageQuery = z.object({
  workspaceId,
  from: isoDate.openapi({
    description: "First day (UTC, inclusive). Default: the 1st of this month.",
  }),
  to: isoDate.openapi({
    description: "Last day (UTC, inclusive). Default: today.",
  }),
});

export const instanceAiUsageQuery = aiUsageQuery.omit({ workspaceId: true });

export const instanceAiTestBody = z
  .strictObject({
    target: z.enum(["cloud", "local"]).optional().openapi({
      description: "Which endpoint to test. Default: the cloud provider.",
    }),
  })
  .openapi("InstanceAiTest");
