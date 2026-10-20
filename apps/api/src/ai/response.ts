import { nullableResponseTimestamp, z } from "../openapi";
import { MODEL_TIERS } from "./types";

// Response schemas of the AI routes (ai/index.ts).

export const aiAvailabilitySchema = z
  .object({
    available: z.boolean().openapi({
      description:
        "Show AI features: on for the instance, the workspace (and the project, if asked), a provider is set up, and the caller has ai:use.",
    }),
    instanceEnabled: z.boolean(),
    configured: z.boolean(),
    workspaceEnabled: z.boolean(),
    projectEnabled: z.boolean().nullable(),
    canUse: z.boolean(),
    canManage: z.boolean(),
    destination: z.enum(["cloud", "local"]).nullable(),
    provider: z.string().nullable(),
    zeroRetention: z.boolean(),
    requireApprovalForWrites: z.boolean(),
    autoTranslateComments: z.boolean().openapi({
      description:
        "The workspace translates comments in another language for each reader without a click.",
    }),
    model: z.string().nullable().openapi({
      description:
        "The model ordinary calls use (the configured name, e.g. a local model or a Claude model id); null when none is set up.",
    }),
    features: z
      .object({
        webSearch: z.boolean().openapi({
          description:
            "Ask may search the web: the instance has a search provider and the workspace turned web search on.",
        }),
        storeConversations: z.boolean().openapi({
          description:
            "Ask conversations are kept on the server (/ai/conversations).",
        }),
        autopilot: z.boolean().openapi({
          description: "Chat may apply changes without a review step.",
        }),
        speech: z.boolean().openapi({
          description:
            "Server speech-to-text is set up (/ai/speech/transcribe).",
        }),
        showReasoning: z.boolean().openapi({
          description:
            "Reasoning text is streamed to the asker; otherwise only how long the model thought.",
        }),
      })
      .openapi("AiFeatureSwitches"),
  })
  .openapi("AiAvailability");

const author = z
  .object({ id: z.string(), name: z.string() })
  .nullable()
  .openapi("AiSettingsAuthor");

const vectorStoreStatus = z
  .enum(["unknown", "available", "unavailable", "ready"])
  .openapi({
    description:
      "pgvector on the server's database: ready (in use), available (created when semantic search is first turned on), unavailable (not installed; search stays full-text), or unknown (not checked yet).",
  });

export const aiSemanticStatusSchema = z
  .object({
    vectorStore: vectorStoreStatus,
    endpointConfigured: z.boolean().openapi({
      description: "The server has an embeddings endpoint.",
    }),
    indexedItems: z.number().int().openapi({
      description:
        "Tasks, pages and comments embedded with the current embedding model.",
    }),
    paused: z
      .enum([
        "AI_DISABLED",
        "AI_NOT_CONFIGURED",
        "AI_ROUTE_BLOCKED",
        "AI_BUDGET_EXCEEDED",
        "AI_RATE_LIMITED",
        "AI_REFUSED",
        "AI_PROVIDER_ERROR",
      ])
      .nullable()
      .openapi({
        description:
          "Why indexing last stopped early on this server (retried every few minutes), or null.",
      }),
  })
  .openapi("AiSemanticStatus");

export const aiSettingsSchema = z
  .object({
    instance: z.object({
      enabled: z.boolean(),
      configured: z.boolean().openapi({
        description: "A provider is set up for ordinary workspace data.",
      }),
      provider: z.enum(["anthropic", "openai_compatible", "fake"]),
      localAvailable: z.boolean().openapi({
        description: "The instance has a local model endpoint.",
      }),
      localOnly: z.boolean(),
      allowWorkspaceKeys: z.boolean(),
      restrictedRoute: z.enum(["blocked", "local", "cloud"]),
      privateRoute: z.enum(["local", "cloud"]),
      redaction: z.boolean(),
      zeroRetention: z.boolean(),
      webSearchAvailable: z.boolean().openapi({
        description: "The instance has a web search provider set up.",
      }),
    }),
    workspace: z.object({
      enabled: z.boolean(),
      provider: z.enum(["anthropic", "openai_compatible"]).nullable(),
      hasKey: z.boolean(),
      keyLast4: z.string().nullable(),
      keyUnreadable: z.boolean(),
      monthlyCapMicros: z.number().int().nullable(),
      userDailyCapTokens: z.number().int().nullable(),
      requireApprovalForWrites: z.boolean(),
      includeRestricted: z.boolean(),
      localOnly: z.boolean(),
      redactPii: z.boolean(),
      autoTranslateComments: z.boolean(),
      embeddingsEnabled: z.boolean().openapi({
        description: "Semantic search is on for the workspace.",
      }),
      webSearchEnabled: z.boolean(),
      storeConversations: z.boolean(),
      allowAutopilot: z.boolean(),
      updatedAt: nullableResponseTimestamp,
      updatedBy: author,
    }),
    semantic: aiSemanticStatusSchema,
    monthSpendMicros: z.number().int().openapi({
      description: "This UTC month's spend so far, by list price.",
    }),
  })
  .openapi("AiSettings");

export const aiTestResultSchema = z
  .object({
    ok: z.boolean(),
    code: z.string().nullable().openapi({
      description: "The AiError code when the test failed.",
    }),
    message: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    destination: z.enum(["cloud", "local"]).nullable(),
    latencyMs: z.number().int().nullable(),
  })
  .openapi("AiTestResult");

const totals = {
  calls: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costMicros: z.number().int().openapi({
    description: "By list price, in micro-dollars (1,000,000 = $1).",
  }),
};

const totalsSchema = z.object(totals);

export const aiUsageSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    totals: totalsSchema,
    byFeature: z.array(z.object({ feature: z.string(), ...totals })),
    byModel: z.array(
      z.object({ provider: z.string(), model: z.string(), ...totals }),
    ),
    byUser: z.array(
      z.object({
        userId: z.string().nullable(),
        name: z.string().nullable(),
        ...totals,
      }),
    ),
    byDay: z.array(z.object({ day: z.string(), ...totals })),
    feedback: z
      .object({
        up: z.number().int(),
        down: z.number().int(),
        byFeature: z.array(
          z.object({
            feature: z.string(),
            up: z.number().int(),
            down: z.number().int(),
          }),
        ),
      })
      .openapi("AiFeedbackSummary", {
        description:
          "Thumbs up and down on AI answers in the range, by feature (POST /ai/feedback).",
      }),
  })
  .openapi("AiUsage");

export const instanceAiUsageSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    totals: totalsSchema,
    byWorkspace: z.array(
      z.object({ workspaceId: z.string(), name: z.string(), ...totals }),
    ),
    byModel: z.array(
      z.object({ provider: z.string(), model: z.string(), ...totals }),
    ),
    byDay: z.array(z.object({ day: z.string(), ...totals })),
  })
  .openapi("InstanceAiUsage");

export const instanceAiStatusSchema = z
  .object({
    enabled: z.boolean(),
    configured: z.boolean(),
    fakeAllowed: z.boolean().openapi({
      description:
        "The fake provider (development and tests) may be selected on this server.",
    }),
    provider: z.enum(["anthropic", "openai_compatible", "fake"]),
    models: z.object(
      Object.fromEntries(MODEL_TIERS.map((tier) => [tier, z.string()])) as {
        fast: z.ZodString;
        balanced: z.ZodString;
        deep: z.ZodString;
      },
    ),
    localAvailable: z.boolean(),
    embeddingsConfigured: z.boolean(),
    vectorStore: vectorStoreStatus,
  })
  .openapi("InstanceAiStatus");
