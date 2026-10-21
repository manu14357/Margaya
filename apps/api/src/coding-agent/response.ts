import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";

// Response schemas of the coding-agent handoff routes. Integration configs
// (tokens, webhook secrets) are never part of any of them.

const provider = z.enum(["github", "gitea"]);

export const codingAgentProfileSchema = z
  .object({
    id: z.string(),
    builtin: z.enum(["claude_code", "copilot", "codex"]).nullable(),
    name: z.string(),
    mention: z.string(),
    assignee: z.string().nullable(),
    enabled: z.boolean(),
    providers: z.array(provider).openapi({
      description:
        "Forges the profile works on: mentions work on both, an assignee only on GitHub.",
    }),
  })
  .openapi("CodingAgentProfile");

export const codingAgentProfileListSchema = z
  .object({
    profiles: z.array(codingAgentProfileSchema),
    canManage: z.boolean(),
  })
  .openapi("CodingAgentProfileList");

export const codingHandoffSchema = z
  .object({
    id: z.string(),
    provider,
    profileName: z.string(),
    issueNumber: z.number().int(),
    issueUrl: z.string(),
    prNumber: z.number().int().nullable(),
    prUrl: z.string().nullable(),
    prTitle: z.string().nullable(),
    state: z.enum([
      "issue_created",
      "working",
      "ready_for_review",
      "merged",
      "closed",
    ]),
    sentBy: z.object({ id: z.string(), name: z.string() }).nullable(),
    createdAt: responseTimestamp,
    workingAt: nullableResponseTimestamp,
    readyAt: nullableResponseTimestamp,
    finishedAt: nullableResponseTimestamp,
  })
  .openapi("CodingHandoff");

export const codingAgentRepositorySchema = z
  .object({
    integrationId: z.string(),
    provider,
    name: z.string().openapi({ description: "owner/repository" }),
    ready: z.boolean().openapi({
      description:
        "The integration can open issues (GitHub: the App is set up and the repository verified; Gitea: a token is set).",
    }),
  })
  .openapi("CodingAgentRepository");

export const codingAgentTaskSchema = z
  .object({
    repositories: z.array(codingAgentRepositorySchema),
    profiles: z.array(codingAgentProfileSchema),
    handoffs: z.array(codingHandoffSchema),
    canSend: z.boolean(),
  })
  .openapi("CodingAgentTask");

export const codingAgentBriefSchema = z
  .object({
    title: z.string(),
    brief: z.string(),
    aiUsed: z.boolean(),
    relatedTasks: z.number().int(),
    linkedPages: z.number().int(),
  })
  .openapi("CodingAgentBrief");

export const codingAgentSendResultSchema = z
  .object({
    handoff: codingHandoffSchema,
    assigned: z.boolean().nullable().openapi({
      description:
        "Whether the profile's assignee was assigned; null when the profile has none or on Gitea.",
    }),
  })
  .openapi("CodingAgentSendResult");

export const deletedProfileSchema = z
  .object({ id: z.string(), deleted: z.literal(true) })
  .openapi("CodingAgentProfileDeleted");
