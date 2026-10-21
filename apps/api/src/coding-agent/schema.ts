import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";

// Request schemas of the coding-agent handoff routes (coding-agent/index.ts).

const profileName = z.string().trim().min(1).max(80).openapi({
  description:
    "Shown when choosing a profile, e.g. “Claude Code (GitHub Action)”.",
});

const mention = z.string().trim().max(300).openapi({
  description:
    "The first line of the issue. A bare handle (“@claude”) gets a short request after it; a longer text is used as written, with {task} and {branch} filled in. Gitea uses mentions only.",
});

const assignee = z
  .string()
  .trim()
  .max(60)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/, {
    message: "Use a GitHub login, such as Copilot",
  })
  .nullable()
  .openapi({
    description:
      "GitHub login assigned to the issue (for example Copilot). Ignored on Gitea.",
  });

export const workspaceQuery = z.object({
  workspaceId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "workspaceId", in: "query" },
      description: "Workspace ID",
    }),
});

export const profileIdParam = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: "id", in: "path" },
      description: "Profile ID",
    }),
});

export const taskIdParam = z.object({
  taskId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "taskId", in: "path" },
      description: "Task ID",
    }),
});

export const createProfileBody = z
  .strictObject({
    workspaceId: z.string().min(1),
    name: profileName,
    mention: mention.optional(),
    assignee: assignee.optional(),
    enabled: z.boolean().optional(),
  })
  .openapi("CodingAgentProfileCreateInput");

export const updateProfileBody = z
  .strictObject({
    name: profileName.optional(),
    mention: mention.optional(),
    assignee: assignee.optional(),
    enabled: z.boolean().optional(),
  })
  .openapi("CodingAgentProfileUpdateInput");

export const prepareBriefBody = z
  .strictObject({
    integrationId: z.string().min(1).openapi({
      description:
        "The connected repository (an integration of the task's project).",
    }),
    useAi: z.boolean().optional().openapi({
      description:
        "Condense the brief through the AI gateway (needs ai:use and AI on for the workspace and project). Off: a fixed outline of the task, its acceptance criteria, related tasks and linked pages.",
    }),
    locale: answerLocale,
  })
  .openapi("CodingAgentBriefInput");

export const sendHandoffBody = z
  .strictObject({
    integrationId: z.string().min(1),
    profileId: z.string().min(1),
    title: z.string().trim().min(1).max(250).openapi({
      description: "The issue title.",
    }),
    brief: z.string().trim().min(1).max(30_000).openapi({
      description:
        "The reviewed brief. Credential-looking values are removed before it is sent.",
    }),
  })
  .openapi("CodingAgentSendInput");
