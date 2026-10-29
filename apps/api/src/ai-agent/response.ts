import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// Response schemas of the agent routes (ai-agent/index.ts).

export const agentSchema = z
  .object({
    id: z.string(),
    userId: z.string().openapi({
      description: "The agent's user: assign or @mention this id.",
    }),
    name: z.string(),
    description: z.string().nullable(),
    image: z.string().nullable(),
    role: z.string().nullable(),
    enabled: z.boolean(),
    modelTier: z.enum(["fast", "balanced", "deep"]),
    providerOverride: z.enum(["local"]).nullable(),
    instructions: z.string().nullable().openapi({
      description: "Only for people with ai:manage.",
    }),
    monthlyBudgetMicros: z.number().int().nullable(),
    monthSpendMicros: z.number().int().nullable().openapi({
      description: "This UTC month's spend; only for people with ai:manage.",
    }),
    projectIds: z.array(z.string()).nullable().openapi({
      description:
        "Projects the agent may work in; null means every project its role reaches. Only for people with ai:manage (null for others).",
    }),
    skillIds: z.array(z.string()).nullable().openapi({
      description:
        "Skills the agent follows. Only for people with ai:manage (null for others).",
    }),
    webAccess: z.boolean().openapi({
      description: "The agent may search the web and call MCP connectors.",
    }),
    intakeTrigger: z
      .object({
        enabled: z.boolean(),
        prompt: z.string().nullable().openapi({
          description:
            "What each run is asked to do; null uses the built-in triage request.",
        }),
        runsAs: z
          .object({ id: z.string(), name: z.string() })
          .nullable()
          .openapi({
            description:
              "The person whose rights cap the runs: whoever last turned the trigger on or saved it. When they leave or lose ai:use or intake:read, it turns itself off.",
          }),
      })
      .nullable()
      .openapi({
        description:
          "Run on every new intake request in the agent's projects. Only for people with ai:manage (null for others).",
      }),
    ownerId: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Agent");

export const agentListSchema = z.array(agentSchema);

const runStatus = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "needs_input",
  "succeeded",
  "failed",
  "cancelled",
]);

export const agentRunSchema = z
  .object({
    id: z.string(),
    agent: z
      .object({ id: z.string(), userId: z.string(), name: z.string() })
      .nullable(),
    principal: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .openapi({ description: "The person whose rights capped the run." }),
    task: z
      .object({
        id: z.string(),
        projectId: z.string(),
        key: z.string(),
        title: z.string(),
      })
      .nullable(),
    project: z
      .object({ id: z.string(), name: z.string(), slug: z.string() })
      .nullable()
      .openapi({ description: "The project the run works in." }),
    trigger: z
      .enum([
        "mention",
        "assign",
        "manual",
        "schedule",
        "automation",
        "chat",
        "intake",
      ])
      .openapi({
        description:
          "What started the run: an @mention, an assignment, Run agent, a schedule, an automation rule, a follow-up to an earlier run (chat), or a new intake request (intake).",
      }),
    followUpOf: z.string().nullable().openapi({
      description: "The earlier run a chat follow-up continues.",
    }),
    status: runStatus,
    question: z
      .object({ text: z.string(), options: z.array(z.string()) })
      .nullable()
      .openapi({
        description:
          "While the run needs input: the agent's question and suggested answers. Only for the person it asks.",
      }),
    request: z.string().nullable().openapi({
      description:
        "The request text the run was given (Run agent, a schedule, an automation rule, an intake trigger or a follow-up). Only for the person the run works for; once the run ends, kept only when the instance stores prompts (ai.retention.storePrompts).",
    }),
    error: z.string().nullable().openapi({
      description:
        "A stable code when the run stopped: AI_BUDGET_EXCEEDED, AI_DISABLED, PRINCIPAL_LEFT, NOT_IN_SCOPE (outside the agent's projects or the person's reach), TIME_LIMIT, OUTPUT_LIMIT, TURN_LIMIT, INTERRUPTED, APPROVAL_EXPIRED (its held changes expired undecided), NEEDS_INPUT_EXPIRED (its question went unanswered for 24 hours), …",
    }),
    outputSummary: z.string().nullable().openapi({
      description:
        "The agent's closing summary. Once every held change is decided, Margaya appends a line saying which were approved, rejected or expired; the run then succeeds when it changed something, is cancelled when everything it proposed was rejected, and fails with APPROVAL_EXPIRED when its proposals expired undecided.",
    }),
    tokenIn: z.number().int(),
    tokenOut: z.number().int(),
    costMicros: z.number().int(),
    toolCalls: z.number().int(),
    pendingApprovals: z.number().int(),
    appliedChanges: z.number().int(),
    createdAt: responseTimestamp,
    startedAt: nullableResponseTimestamp,
    finishedAt: nullableResponseTimestamp,
  })
  .openapi("AgentRun");

export const agentRunListSchema = z.array(agentRunSchema);

export const agentRunStepSchema = z
  .object({
    id: z.string(),
    seq: z.number().int(),
    kind: z.enum(["model", "tool"]),
    toolName: z.string().nullable(),
    risk: z.enum(["read", "write", "destructive"]).nullable(),
    args: z.record(z.string(), z.unknown()).nullable().openapi({
      description: "Redacted and shortened tool arguments.",
    }),
    status: z.enum([
      "ok",
      "error",
      "denied",
      "pending",
      "applied",
      "rejected",
      "expired",
      "reverted",
    ]),
    reason: z.string().nullable(),
    change: z.record(z.string(), z.unknown()).nullable().openapi({
      description:
        "The change-set entry of a write: op, the task, and before and after values.",
    }),
    text: z.string().nullable().openapi({
      description:
        "What the model wrote in a model step; null unless the instance stores prompts (ai.retention.storePrompts).",
    }),
    links: z
      .object({
        taskUrl: z.string().nullable(),
        createdUrl: z.string().nullable(),
      })
      .openapi({
        description:
          "App paths of the task a change touched and of what it created or linked (a page, a sub-task, the other task); null when none.",
      }),
    tokenIn: z.number().int(),
    tokenOut: z.number().int(),
    costMicros: z.number().int(),
    appliedAt: nullableResponseTimestamp,
    revertedAt: nullableResponseTimestamp,
    canUndo: z.boolean(),
    approval: z
      .object({
        id: z.string(),
        status: z.enum(["pending", "approved", "rejected", "expired"]),
        expiresAt: responseTimestamp,
        canDecide: z.boolean(),
      })
      .nullable(),
    createdAt: responseTimestamp,
  })
  .openapi("AgentRunStep");

export const agentRunDetailSchema = agentRunSchema
  .extend({ steps: z.array(agentRunStepSchema) })
  .openapi("AgentRunDetail");

export const agentApprovalSchema = z
  .object({
    id: z.string(),
    runId: z.string(),
    stepId: z.string(),
    toolName: z.string(),
    change: z.record(z.string(), z.unknown()).nullable(),
    agent: z
      .object({ id: z.string(), userId: z.string(), name: z.string() })
      .nullable(),
    createdAt: responseTimestamp,
    expiresAt: responseTimestamp,
  })
  .openapi("AgentApproval");

export const agentApprovalListSchema = z.array(agentApprovalSchema);

export const startedRunSchema = z
  .object({ id: z.string(), status: runStatus })
  .openapi("StartedAgentRun");

export const decisionSchema = z
  .object({
    id: z.string(),
    status: z.enum(["approved", "rejected"]),
  })
  .openapi("AgentApprovalDecision");

export const undoSchema = z
  .object({ id: z.string(), status: z.literal("reverted") })
  .openapi("AgentChangeUndone");

export const deletedAgentSchema = z
  .object({ id: z.string() })
  .openapi("DeletedAgent");

export const agentTemplateSchema = z
  .object({
    id: z.string(),
    name: z.string().openapi({ description: "Default name (English)." }),
    instructions: z.string(),
    role: z.string(),
    modelTier: z.enum(["fast", "balanced", "deep"]),
    suggestedTriggers: z.array(
      z.enum(["mention", "assign", "schedule", "automation"]),
    ),
    suggestedSchedule: z
      .object({ cron: z.string(), prompt: z.string() })
      .nullable(),
  })
  .openapi("AgentTemplate");

export const agentTemplateListSchema = z.array(agentTemplateSchema);

export const agentScheduleSchema = z
  .object({
    id: z.string(),
    agentId: z.string(),
    project: z
      .object({ id: z.string(), name: z.string(), slug: z.string() })
      .nullable(),
    task: z
      .object({ id: z.string(), key: z.string(), title: z.string() })
      .nullable(),
    cron: z.string(),
    timezone: z.string(),
    prompt: z.string(),
    enabled: z.boolean(),
    runsAs: z.object({ id: z.string(), name: z.string() }).nullable().openapi({
      description:
        "The person whose rights cap the runs: whoever last saved the schedule. When they leave or lose ai:use, the schedule turns itself off.",
    }),
    lastRunAt: nullableResponseTimestamp,
    nextRunAt: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("AgentSchedule");

export const agentScheduleListSchema = z.array(agentScheduleSchema);

export const deletedScheduleSchema = z
  .object({ id: z.string() })
  .openapi("DeletedAgentSchedule");
