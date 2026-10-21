import { HTTPException } from "hono/http-exception";
import { assertAiEnabled } from "../ai/access";
import { aiErrorResponse } from "../ai/sse";
import { recordAudit } from "../audit-log/record";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  composeIssueBody,
  loadHandoffTask,
  prepareBrief,
  stripSecrets,
  suggestedBranch,
  taskKeyOf,
} from "./brief";
import {
  type HandoffRow,
  integrationBranchConfig,
  integrationSecrets,
  listTaskHandoffs,
  loadIntegrationForProject,
  openIssue,
  projectRepositories,
  recordHandoff,
} from "./handoffs";
import {
  type CodingAgentProfile,
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  profileWorksOn,
  renderMention,
  updateProfile,
} from "./profiles";
import {
  codingAgentBriefSchema,
  codingAgentProfileListSchema,
  codingAgentProfileSchema,
  codingAgentSendResultSchema,
  codingAgentTaskSchema,
  deletedProfileSchema,
} from "./response";
import {
  createProfileBody,
  prepareBriefBody,
  profileIdParam,
  sendHandoffBody,
  taskIdParam,
  updateProfileBody,
  workspaceQuery,
} from "./schema";

// Coding-agent handoff (C4): send a task to a coding agent as an issue on
// the project's GitHub or Gitea repository, then follow the pull request
// back on the task. Profiles are workspace settings, managed by whoever
// manages integrations (workspace:manage_settings).

const TAGS = ["Coding agents"];

const manageProfiles = requireWorkspacePermission({
  workspace: ["manage_settings"],
});

function profileJson(profile: CodingAgentProfile) {
  return {
    id: profile.id,
    builtin: profile.builtin ?? null,
    name: profile.name,
    mention: profile.mention,
    assignee: profile.assignee,
    enabled: profile.enabled,
    providers: (["github", "gitea"] as const).filter((provider) =>
      profileWorksOn(profile, provider),
    ),
  };
}

function handoffJson(handoff: HandoffRow, senderName: string | null) {
  return {
    id: handoff.id,
    provider: handoff.provider,
    profileName: handoff.profileName,
    issueNumber: handoff.issueNumber,
    issueUrl: handoff.issueUrl,
    prNumber: handoff.prNumber,
    prUrl: handoff.prUrl,
    prTitle: handoff.prTitle,
    state: handoff.state,
    sentBy: handoff.createdBy
      ? { id: handoff.createdBy, name: senderName ?? "" }
      : null,
    createdAt: handoff.createdAt,
    workingAt: handoff.workingAt,
    readyAt: handoff.readyAt,
    finishedAt: handoff.finishedAt,
  };
}

const listProfilesRoute = createRoute({
  method: "get",
  operationId: "listCodingAgentProfiles",
  path: "/profiles",
  tags: TAGS,
  summary: "List coding agent profiles",
  description:
    "The workspace's coding agent profiles: the built-in Claude Code, GitHub Copilot and Codex templates plus custom ones. A profile is only a mention or assignee template for the issue; no third-party AI key is stored.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse("The profiles", codingAgentProfileListSchema),
    403: errorResponse("No access to the workspace"),
  },
});

const createProfileRoute = createRoute({
  method: "post",
  operationId: "createCodingAgentProfile",
  path: "/profiles",
  tags: TAGS,
  summary: "Create a coding agent profile",
  description:
    "Add a custom profile: a mention line and/or a GitHub assignee. Needs workspace:manage_settings. Audited as coding_agent.profile_created.",
  middleware: [workspaceAccess.fromBody(), manageProfiles] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createProfileBody } },
    },
  },
  responses: {
    200: jsonResponse("The new profile", codingAgentProfileSchema),
    400: errorResponse("Invalid body, or neither a mention nor an assignee"),
    403: errorResponse("Missing workspace:manage_settings"),
  },
});

const updateProfileRoute = createRoute({
  method: "patch",
  operationId: "updateCodingAgentProfile",
  path: "/profiles/{id}",
  tags: TAGS,
  summary: "Update a coding agent profile",
  description:
    "Rename a profile, change its mention or assignee, or turn it on or off. Needs workspace:manage_settings. Audited as coding_agent.profile_updated.",
  middleware: [workspaceAccess.fromQuery(), manageProfiles] as const,
  request: {
    params: profileIdParam,
    query: workspaceQuery,
    body: {
      required: true,
      content: { "application/json": { schema: updateProfileBody } },
    },
  },
  responses: {
    200: jsonResponse("The profile after the change", codingAgentProfileSchema),
    400: errorResponse("Invalid body, or neither a mention nor an assignee"),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Profile not found"),
  },
});

const deleteProfileRoute = createRoute({
  method: "delete",
  operationId: "deleteCodingAgentProfile",
  path: "/profiles/{id}",
  tags: TAGS,
  summary: "Delete a custom coding agent profile",
  description:
    "Delete a custom profile; built-in profiles can only be turned off. Past handoffs keep the profile's name. Needs workspace:manage_settings.",
  middleware: [workspaceAccess.fromQuery(), manageProfiles] as const,
  request: { params: profileIdParam, query: workspaceQuery },
  responses: {
    200: jsonResponse("Deleted", deletedProfileSchema),
    400: errorResponse("A built-in profile"),
    403: errorResponse("Missing workspace:manage_settings"),
    404: errorResponse("Profile not found"),
  },
});

const taskRoute = createRoute({
  method: "get",
  operationId: "getTaskCodingAgents",
  path: "/task/{taskId}",
  tags: TAGS,
  summary: "Coding agent handoffs of a task",
  description:
    "The task's handoffs with their timeline (issue created, agent working, ready for review, merged or closed), the project's connected repositories and the enabled profiles. Needs task:read; restricted projects answer 404 to people outside them.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("Handoffs and options", codingAgentTaskSchema),
    403: errorResponse("Missing task:read"),
    404: errorResponse("Task not found"),
  },
});

const briefRoute = createRoute({
  method: "post",
  operationId: "prepareCodingAgentBrief",
  path: "/task/{taskId}/brief",
  tags: TAGS,
  summary: "Prepare a coding agent brief",
  description:
    "Build the brief for review: the task, its acceptance criteria, related tasks and linked pages the caller may see (never other restricted projects), with credential-looking values removed. With useAi, it is condensed through the AI gateway (feature coding_handoff). Nothing is sent. Needs task:update.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: prepareBriefBody } },
    },
  },
  responses: {
    200: jsonResponse("The brief, ready to edit", codingAgentBriefSchema),
    403: aiErrorResponse(
      "Missing task:update, or with useAi: missing ai:use or AI is off (AI_DISABLED)",
    ),
    404: errorResponse("Task or repository not found"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The AI provider failed (AI_PROVIDER_ERROR)"),
  },
});

const sendRoute = createRoute({
  method: "post",
  operationId: "sendToCodingAgent",
  path: "/task/{taskId}/send",
  tags: TAGS,
  summary: "Send a task to a coding agent",
  description:
    "Open an issue on the connected repository with the reviewed brief and the profile's mention (and, on GitHub, its assignee), through the project's existing integration. Pull requests that reference the issue or use the task's branch are linked back to the task; the task only moves when the integration's own status rules say so, and nothing is ever merged. Needs task:update. Audited as coding_agent.handoff_sent.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: sendHandoffBody } },
    },
  },
  responses: {
    200: jsonResponse("The handoff", codingAgentSendResultSchema),
    400: errorResponse("The profile is off or does not work on this forge"),
    403: errorResponse("Missing task:update"),
    404: errorResponse("Task, repository or profile not found"),
    409: errorResponse("The integration is not ready to open issues"),
    502: errorResponse("The repository did not accept the issue"),
  },
});

const codingAgent = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listProfilesRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const can = await workspacePermissionChecker(c);
    const profiles = await listProfiles(workspaceId);
    return c.json(
      {
        profiles: profiles.map(profileJson),
        canManage: can({ workspace: ["manage_settings"] }),
      },
      200,
    );
  })
  .openapi(createProfileRoute, async (c) => {
    const { workspaceId, ...input } = c.req.valid("json");
    const profile = await createProfile(workspaceId, input);
    await recordAudit({
      workspaceId,
      action: "coding_agent.profile_created",
      target: {
        type: "coding_agent_profile",
        id: profile.id,
        label: profile.name,
      },
      metadata: { mention: profile.mention, assignee: profile.assignee },
    });
    return c.json(profileJson(profile), 200);
  })
  .openapi(updateProfileRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const { before, after } = await updateProfile(
      workspaceId,
      id,
      c.req.valid("json"),
    );
    const changed = (
      ["name", "mention", "assignee", "enabled"] as const
    ).filter((key) => before[key] !== after[key]);
    if (changed.length > 0) {
      await recordAudit({
        workspaceId,
        action: "coding_agent.profile_updated",
        target: {
          type: "coding_agent_profile",
          id: after.id,
          label: after.name,
        },
        metadata: { changed },
      });
    }
    return c.json(profileJson(after), 200);
  })
  .openapi(deleteProfileRoute, async (c) => {
    const { id } = c.req.valid("param");
    const workspaceId = c.get("workspaceId");
    const profile = await deleteProfile(workspaceId, id);
    await recordAudit({
      workspaceId,
      action: "coding_agent.profile_deleted",
      target: { type: "coding_agent_profile", id, label: profile.name },
    });
    return c.json({ id, deleted: true as const }, 200);
  })
  .openapi(taskRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const task = await loadHandoffTask(taskId);
    const can = await workspacePermissionChecker(c);
    const [repositories, profiles, handoffs] = await Promise.all([
      projectRepositories(task.projectId),
      listProfiles(task.workspaceId),
      listTaskHandoffs(task.id),
    ]);
    return c.json(
      {
        repositories,
        profiles: profiles
          .filter((profile) => profile.enabled)
          .map(profileJson)
          .filter((profile) => profile.providers.length > 0),
        handoffs: handoffs.map(({ handoff, senderName }) =>
          handoffJson(handoff, senderName),
        ),
        canSend: can({ task: ["update"] }),
      },
      200,
    );
  })
  .openapi(briefRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const { integrationId, useAi, locale } = c.req.valid("json");
    const task = await loadHandoffTask(taskId);
    // The repository must belong to the task's project (and stay hidden
    // otherwise), even though nothing is sent yet.
    await loadIntegrationForProject(task.projectId, integrationId);
    if (useAi) {
      const can = await workspacePermissionChecker(c);
      if (!can({ ai: ["use"] })) {
        throw new HTTPException(403, { message: "Insufficient permissions" });
      }
      await assertAiEnabled(task.workspaceId);
    }
    const prepared = await prepareBrief(c, task, {
      useAi: Boolean(useAi),
      locale,
    });
    return c.json(
      {
        title: prepared.title,
        brief: prepared.body,
        aiUsed: prepared.aiUsed,
        relatedTasks: prepared.related,
        linkedPages: prepared.pages,
      },
      200,
    );
  })
  .openapi(sendRoute, async (c) => {
    const { taskId } = c.req.valid("param");
    const { integrationId, profileId, title, brief } = c.req.valid("json");
    const userId = c.get("userId");
    const task = await loadHandoffTask(taskId);
    const integration = await loadIntegrationForProject(
      task.projectId,
      integrationId,
    );
    const provider = integration.type as "github" | "gitea";
    const profile = await getProfile(task.workspaceId, profileId);
    if (!profile.enabled || !profileWorksOn(profile, provider)) {
      throw new HTTPException(400, {
        message: "This profile is off or does not work with this repository",
      });
    }
    const key = taskKeyOf(task);
    const branch = suggestedBranch(integrationBranchConfig(integration), task);
    const clientUrl = (
      process.env.MARGAYA_CLIENT_URL || "http://localhost:5173"
    ).replace(/\/+$/, "");
    const secrets = integrationSecrets(integration);
    const body = composeIssueBody({
      mentionLine: renderMention(profile.mention, {
        task: key,
        branch: branch ?? key.toLowerCase(),
      }),
      brief,
      taskKey: key,
      taskUrl: `${clientUrl}/dashboard/workspace/${task.workspaceId}/project/${task.projectId}/task/${task.id}`,
      branch,
      knownSecrets: secrets,
    });
    const opened = await openIssue(integration, {
      title: stripSecrets(title, secrets),
      body,
      assignee: provider === "github" ? profile.assignee : null,
    });
    const handoff = await recordHandoff({
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      taskId: task.id,
      integrationId: integration.id,
      provider,
      profileId: profile.id,
      profileName: profile.name,
      issueNumber: opened.number,
      issueUrl: opened.url,
      createdBy: userId,
    });
    await recordAudit({
      workspaceId: task.workspaceId,
      action: "coding_agent.handoff_sent",
      target: { type: "task", id: task.id, label: key },
      metadata: {
        profile: profile.name,
        provider,
        issueNumber: opened.number,
        issueUrl: opened.url,
      },
    });
    const sender = c.get("user") as { name?: string | null } | null;
    return c.json(
      {
        handoff: handoffJson(handoff, sender?.name ?? null),
        assigned: opened.assigned,
      },
      200,
    );
  });

export default codingAgent;
