import { z } from "../openapi";

// Request schemas of the agent routes (ai-agent/index.ts).

const workspaceId = z.string().min(1).openapi({ description: "Workspace ID" });

export const agentWorkspaceQuery = z.object({ workspaceId });
export const agentWorkspaceBody = z.object({ workspaceId });

const MAX_BUDGET_MICROS = 1_000_000_000_000;
export const MAX_AGENT_SKILLS = 10;

const agentFields = {
  name: z.string().trim().min(1).max(80).openapi({
    description: "Shown everywhere the agent appears, like a person's name.",
  }),
  description: z.string().trim().max(500).nullable().optional(),
  instructions: z.string().max(8_000).optional().openapi({
    description:
      "What the agent is for and how it should work. Written by admins and trusted; task, comment and page content never is.",
  }),
  modelTier: z.enum(["fast", "balanced", "deep"]).optional(),
  providerOverride: z.enum(["local"]).nullable().optional().openapi({
    description:
      "local: always use the instance's local model. Null follows the workspace's routing.",
  }),
  role: z.string().trim().min(1).max(64).optional().openapi({
    description:
      "The agent's workspace role (default member). Never owner or admin, and within your own role. A run's rights are also capped at the invoking person's.",
  }),
  enabled: z.boolean().optional(),
  monthlyBudgetMicros: z
    .number()
    .int()
    .min(0)
    .max(MAX_BUDGET_MICROS)
    .nullable()
    .optional()
    .openapi({
      description:
        "Spend cap per UTC month in micro-dollars (1,000,000 = $1); a run stops once reached. Null: only the workspace's caps apply.",
    }),
  projectIds: z
    .array(z.string().min(1).max(64))
    .max(200)
    .nullable()
    .optional()
    .openapi({
      description:
        "Projects the agent may work in. Null: every project its role and the invoking person reach. Runs elsewhere stop with NOT_IN_SCOPE.",
    }),
  skillIds: z
    .array(z.string().min(1).max(64))
    .max(MAX_AGENT_SKILLS)
    .optional()
    .openapi({
      description:
        "Shared skills (saved prompts) the agent follows; their prompts are added to its instructions on every run.",
    }),
  webAccess: z.boolean().optional().openapi({
    description:
      "Lets the agent search the web (when the instance has web search) and call the workspace's MCP connectors.",
  }),
};

export const createAgentBody = z
  .strictObject({ workspaceId, ...agentFields })
  .openapi("CreateAgent");

export const updateAgentBody = z
  .strictObject({
    workspaceId,
    ...agentFields,
    name: agentFields.name.optional(),
  })
  .openapi("UpdateAgent");

export const agentIdParam = z.object({
  agentId: z
    .string()
    .min(1)
    .openapi({ param: { name: "agentId", in: "path" } }),
});

export const runIdParam = z.object({
  runId: z
    .string()
    .min(1)
    .openapi({ param: { name: "runId", in: "path" } }),
});

export const stepIdParam = z.object({
  stepId: z
    .string()
    .min(1)
    .openapi({ param: { name: "stepId", in: "path" } }),
});

export const approvalIdParam = z.object({
  approvalId: z
    .string()
    .min(1)
    .openapi({ param: { name: "approvalId", in: "path" } }),
});

export const startRunBody = z
  .strictObject({
    workspaceId,
    taskId: z.string().min(1).openapi({
      description: "The task the agent works on.",
    }),
    prompt: z.string().trim().min(1).max(4_000).openapi({
      description: "What you want the agent to do.",
    }),
  })
  .openapi("StartAgentRun");

export const listRunsQuery = z.object({
  workspaceId,
  agentId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  status: z
    .enum([
      "queued",
      "running",
      "awaiting_approval",
      "needs_input",
      "succeeded",
      "failed",
      "cancelled",
    ])
    .optional(),
  before: z.iso.datetime().optional().openapi({
    description: "Runs created before this instant (paging).",
  }),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const runReplyBody = z
  .strictObject({
    workspaceId,
    text: z.string().trim().min(1).max(4_000).openapi({
      description: "Your answer to the agent's question.",
    }),
  })
  .openapi("AgentRunReply");

export const runFollowUpBody = z
  .strictObject({
    workspaceId,
    text: z.string().trim().min(1).max(4_000).openapi({
      description: "What you want the agent to do next.",
    }),
  })
  .openapi("AgentRunFollowUp");

// --- The intake trigger ---

export const intakeTriggerBody = z
  .strictObject({
    workspaceId,
    enabled: z.boolean().openapi({
      description:
        "Run the agent on every new intake request in its projects. Turning it on makes you the person the runs act for.",
    }),
    prompt: z.string().trim().max(4_000).nullable().optional().openapi({
      description:
        "What each run should do. Null or blank: triage (summarize, judge urgency, point out gaps and duplicates in a comment). Omitted: unchanged.",
    }),
  })
  .openapi("AgentIntakeTrigger");

// --- Schedules ---

export const scheduleIdParam = z.object({
  agentId: z
    .string()
    .min(1)
    .openapi({ param: { name: "agentId", in: "path" } }),
  scheduleId: z
    .string()
    .min(1)
    .openapi({ param: { name: "scheduleId", in: "path" } }),
});

const scheduleFields = {
  projectId: z.string().min(1).max(64).openapi({
    description: "The project the runs work in.",
  }),
  taskId: z.string().min(1).max(64).nullable().optional().openapi({
    description:
      "A task of that project to work on. Null: a project-level run, which reports on a page.",
  }),
  cron: z.string().trim().min(9).max(100).openapi({
    description:
      "Five cron fields (minute hour day month weekday), for example 0 9 * * 1-5. At most every 15 minutes.",
    example: "0 9 * * 1-5",
  }),
  timezone: z.string().trim().min(1).max(64).openapi({
    description: "IANA time zone the cron fields are read in.",
    example: "Europe/Berlin",
  }),
  prompt: z.string().trim().min(1).max(4_000).openapi({
    description: "What the agent does on every run.",
  }),
  enabled: z.boolean().optional(),
};

export const createScheduleBody = z
  .strictObject({ workspaceId, ...scheduleFields })
  .openapi("CreateAgentSchedule");

export const updateScheduleBody = z
  .strictObject({
    workspaceId,
    projectId: scheduleFields.projectId.optional(),
    taskId: scheduleFields.taskId,
    cron: scheduleFields.cron.optional(),
    timezone: scheduleFields.timezone.optional(),
    prompt: scheduleFields.prompt.optional(),
    enabled: scheduleFields.enabled,
  })
  .openapi("UpdateAgentSchedule");
