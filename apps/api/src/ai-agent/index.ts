import { requireAiEnabled, requireAiManage, requireAiUse } from "../ai/access";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { isInstanceAdmin } from "../utils/is-instance-admin";
import {
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { decideApproval, undoStep } from "./approvals";
import {
  cancelRun,
  followUpRun,
  getRun,
  listMyApprovals,
  listRuns,
  replyToRun,
  startManualRun,
} from "./desk";
import { publishRunUpdated } from "./events";
import { createAgent, deleteAgent, listAgents, updateAgent } from "./identity";
import {
  agentApprovalListSchema,
  agentListSchema,
  agentRunDetailSchema,
  agentRunListSchema,
  agentScheduleListSchema,
  agentScheduleSchema,
  agentSchema,
  agentTemplateListSchema,
  decisionSchema,
  deletedAgentSchema,
  deletedScheduleSchema,
  startedRunSchema,
  undoSchema,
} from "./response";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
} from "./schedules";
import {
  agentIdParam,
  agentWorkspaceBody,
  agentWorkspaceQuery,
  approvalIdParam,
  createAgentBody,
  createScheduleBody,
  listRunsQuery,
  runFollowUpBody,
  runIdParam,
  runReplyBody,
  scheduleIdParam,
  startRunBody,
  stepIdParam,
  updateAgentBody,
  updateScheduleBody,
} from "./schema";
import { AGENT_TEMPLATES } from "./templates";
// Side effects: the mention and assignment triggers, realtime hints.
import "./triggers";

// Agents (C1–C3): identity and settings, runs, the Agent Desk, approvals
// and undo. Every write an agent makes goes through the API's own routes
// with a short-lived key capped at the invoking person's rights.

const TAGS = ["AI agents"];
const json = <T>(schema: T) => ({
  required: true,
  content: { "application/json": { schema } },
});
const forbidden = errorResponse(
  "No workspace access, a missing permission (ai:use, ai:manage), or AI is off (AI_DISABLED)",
);

const listAgentsRoute = createRoute({
  method: "get",
  operationId: "listAgents",
  path: "/",
  tags: TAGS,
  summary: "List agents",
  description:
    "The workspace's AI agents. Any member may list them (to mark agents on avatars and keep them out of human-only pickers); instructions, budget and spend only come with ai:manage.",
  middleware: [workspaceAccess.fromQuery()] as const,
  request: { query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The agents", agentListSchema),
    403: errorResponse("No workspace access"),
  },
});

const createAgentRoute = createRoute({
  method: "post",
  operationId: "createAgent",
  path: "/",
  tags: TAGS,
  summary: "Create an agent",
  description:
    "Add an AI agent: a workspace member with a role that can't sign in, receive invitations or email, and is never a billable seat. It can be assigned and @mentioned. Its name must differ (ignoring case) from every other member's of the workspace, agent or person, so @mentions stay unambiguous. At most 25 per workspace. Recorded in the audit log. Needs ai:manage.",
  middleware: [workspaceAccess.fromBody(), requireAiManage] as const,
  request: { body: json(createAgentBody) },
  responses: {
    200: jsonResponse("The agent", agentSchema),
    400: errorResponse("Invalid body, unknown role, or an owner or admin role"),
    403: forbidden,
    409: errorResponse(
      "The workspace already has 25 agents, or the name is taken (code AGENT_NAME_TAKEN): another agent or member of the workspace has it, ignoring case",
    ),
  },
});

const updateAgentRoute = createRoute({
  method: "patch",
  operationId: "updateAgent",
  path: "/{agentId}",
  tags: TAGS,
  summary: "Update an agent",
  description:
    "Change an agent's name, description, instructions, model tier, provider override, role, budget, project allow-list, skills or web access, or turn it off. A new name must differ (ignoring case) from every other member's of the workspace. Recorded in the audit log (field names only). Needs ai:manage.",
  middleware: [workspaceAccess.fromBody(), requireAiManage] as const,
  request: { params: agentIdParam, body: json(updateAgentBody) },
  responses: {
    200: jsonResponse("The agent", agentSchema),
    400: errorResponse("Invalid body, unknown role, or an owner or admin role"),
    403: forbidden,
    404: errorResponse("Agent not found"),
    409: errorResponse(
      "The new name is taken (code AGENT_NAME_TAKEN): another agent or member of the workspace has it, ignoring case",
    ),
  },
});

const deleteAgentRoute = createRoute({
  method: "delete",
  operationId: "deleteAgent",
  path: "/{agentId}",
  tags: TAGS,
  summary: "Delete an agent",
  description:
    "Remove an agent and its membership. Its comments and history stay; its runs stay in the Agent Desk. Needs ai:manage.",
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { params: agentIdParam, query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The deleted agent", deletedAgentSchema),
    403: forbidden,
    404: errorResponse("Agent not found"),
  },
});

const startRunRoute = createRoute({
  method: "post",
  operationId: "startAgentRun",
  path: "/{agentId}/runs",
  tags: TAGS,
  summary: "Run an agent on a task",
  description:
    "Queue a run of the agent on a task you can see, in a project with AI on. The run acts as the agent with its role capped at your rights, through the API; writes are applied with one-click undo, or wait for your approval when the workspace requires it or the change is destructive. Refused with AI_BUDGET_EXCEEDED (429) when a budget is already used up. Needs ai:use and task:read.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireWorkspacePermission({ task: ["read"] }),
    requireAiEnabled(),
  ] as const,
  request: { params: agentIdParam, body: json(startRunBody) },
  responses: {
    200: jsonResponse("The queued run", startedRunSchema),
    403: forbidden,
    404: errorResponse("Agent or task not found"),
    409: errorResponse(
      "The agent is turned off, or the task's project is outside the agent's projects (code OUTSIDE_AGENT_PROJECTS)",
    ),
    429: errorResponse(
      "AI_BUDGET_EXCEEDED: the agent's monthly budget, the workspace's monthly AI budget or your daily AI limit is used up; nothing is queued",
    ),
  },
});

const listRunsRoute = createRoute({
  method: "get",
  operationId: "listAgentRuns",
  path: "/runs",
  tags: TAGS,
  summary: "List agent runs",
  description:
    "Agent Desk: runs newest first, with status, cost and change counts. Your own runs; every run of the workspace with ai:manage. Runs in projects you can't see are left out.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { query: listRunsQuery },
  responses: {
    200: jsonResponse("The runs", agentRunListSchema),
    403: forbidden,
  },
});

const getRunRoute = createRoute({
  method: "get",
  operationId: "getAgentRun",
  path: "/runs/{runId}",
  tags: TAGS,
  summary: "Get an agent run",
  description:
    "One run with its steps timeline: model calls and tool calls (redacted arguments, no prompts), and the change set with before and after values, approval state and undo.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { params: runIdParam, query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The run", agentRunDetailSchema),
    403: forbidden,
    404: errorResponse("Run not found"),
  },
});

const cancelRunRoute = createRoute({
  method: "post",
  operationId: "cancelAgentRun",
  path: "/runs/{runId}/cancel",
  tags: TAGS,
  summary: "Cancel an agent run",
  description:
    "Stop a queued or running run, or one waiting for an answer; changes already applied stay (undo them one by one). The run's person or ai:manage.",
  middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
  request: { params: runIdParam, body: json(agentWorkspaceBody) },
  responses: {
    200: jsonResponse("The cancelled run", startedRunSchema),
    403: forbidden,
    404: errorResponse("Run not found"),
    409: errorResponse("The run has already ended"),
  },
});

const undoRoute = createRoute({
  method: "post",
  operationId: "undoAgentChange",
  path: "/steps/{stepId}/undo",
  tags: TAGS,
  summary: "Undo an agent change",
  description:
    "Revert one applied change through the API (restore the old values, delete the comment, sub-task or link it made, or restore a trashed task). Runs as the agent with your rights; the run's person or ai:manage. Recorded in the audit log.",
  middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
  request: { params: stepIdParam, body: json(agentWorkspaceBody) },
  responses: {
    200: jsonResponse("The reverted change", undoSchema),
    403: forbidden,
    404: errorResponse("Change not found"),
    409: errorResponse(
      "Not an applied change, or the task changed so it can't be reverted",
    ),
  },
});

const listApprovalsRoute = createRoute({
  method: "get",
  operationId: "listAgentApprovals",
  path: "/approvals",
  tags: TAGS,
  summary: "List my pending agent approvals",
  description:
    "Changes agents proposed on your behalf that wait for you, with a before/after preview. They expire after 24 hours.",
  middleware: [workspaceAccess.fromQuery(), requireAiUse] as const,
  request: { query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The approvals", agentApprovalListSchema),
    403: forbidden,
  },
});

const decide = (decision: "approve" | "reject") =>
  createRoute({
    method: "post",
    operationId:
      decision === "approve" ? "approveAgentChange" : "rejectAgentChange",
    path: `/approvals/{approvalId}/${decision}`,
    tags: TAGS,
    summary:
      decision === "approve"
        ? "Approve an agent change"
        : "Reject an agent change",
    description:
      decision === "approve"
        ? "Apply the held change through the API as the agent, with its role capped at your rights. Only the person it waits for. Recorded in the audit log."
        : "Discard the held change; nothing is applied. Only the person it waits for.",
    middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
    request: { params: approvalIdParam, body: json(agentWorkspaceBody) },
    responses: {
      200: jsonResponse("The decision", decisionSchema),
      403: forbidden,
      404: errorResponse("Approval not found"),
      409: errorResponse("Already decided, expired, or the task changed"),
    },
  });

const approveRoute = decide("approve");
const rejectRoute = decide("reject");

const templatesRoute = createRoute({
  method: "get",
  operationId: "listAgentTemplates",
  path: "/templates",
  tags: TAGS,
  summary: "List agent templates",
  description:
    "Ready-made agents (Triage, Standup, Spec writer, Delivery risk, Customer feedback): instructions, role, model tier, suggested triggers and, for some, a suggested schedule. Picking one only fills the new-agent form. Needs ai:manage.",
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The templates", agentTemplateListSchema),
    403: forbidden,
  },
});

const listSchedulesRoute = createRoute({
  method: "get",
  operationId: "listAgentSchedules",
  path: "/{agentId}/schedules",
  tags: TAGS,
  summary: "List an agent's schedules",
  description:
    "The agent's schedules with their next and last run. Needs ai:manage.",
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { params: agentIdParam, query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The schedules", agentScheduleListSchema),
    403: forbidden,
    404: errorResponse("Agent not found"),
  },
});

const scheduleErrors = {
  400: errorResponse(
    "Invalid body; the project or task isn't usable (AI off, not visible, outside the agent's projects: code OUTSIDE_AGENT_PROJECTS); or the cron or time zone is invalid (codes CRON_INVALID, CRON_TOO_FREQUENT, CRON_NEVER, TIMEZONE_INVALID)",
  ),
  403: errorResponse(
    "No workspace access, no ai:manage, or no ai:use (scheduled runs act for the person who saves the schedule)",
  ),
  404: errorResponse("Agent or schedule not found"),
};

const createScheduleRoute = createRoute({
  method: "post",
  operationId: "createAgentSchedule",
  path: "/{agentId}/schedules",
  tags: TAGS,
  summary: "Schedule an agent",
  description:
    "Run the agent with a prompt on a cron schedule in a time zone, on a task or (without one) on a project. Runs act for you, capped at your rights, and stop when you leave the workspace or lose ai:use (the schedule then turns off, with the reason in the audit log). At most every 15 minutes; 20 schedules per agent. Needs ai:manage and ai:use.",
  middleware: [workspaceAccess.fromBody(), requireAiManage] as const,
  request: { params: agentIdParam, body: json(createScheduleBody) },
  responses: {
    200: jsonResponse("The schedule", agentScheduleSchema),
    ...scheduleErrors,
    409: errorResponse("The agent already has 20 schedules"),
  },
});

const updateScheduleRoute = createRoute({
  method: "patch",
  operationId: "updateAgentSchedule",
  path: "/{agentId}/schedules/{scheduleId}",
  tags: TAGS,
  summary: "Update an agent schedule",
  description:
    "Change a schedule's project, task, cron, time zone, prompt, or turn it on or off. Saving makes you the person its runs act for. Needs ai:manage and ai:use.",
  middleware: [workspaceAccess.fromBody(), requireAiManage] as const,
  request: { params: scheduleIdParam, body: json(updateScheduleBody) },
  responses: {
    200: jsonResponse("The schedule", agentScheduleSchema),
    ...scheduleErrors,
  },
});

const deleteScheduleRoute = createRoute({
  method: "delete",
  operationId: "deleteAgentSchedule",
  path: "/{agentId}/schedules/{scheduleId}",
  tags: TAGS,
  summary: "Delete an agent schedule",
  description: "Remove a schedule; its past runs stay. Needs ai:manage.",
  middleware: [workspaceAccess.fromQuery(), requireAiManage] as const,
  request: { params: scheduleIdParam, query: agentWorkspaceQuery },
  responses: {
    200: jsonResponse("The deleted schedule", deletedScheduleSchema),
    403: forbidden,
    404: errorResponse("Agent or schedule not found"),
  },
});

const replyRoute = createRoute({
  method: "post",
  operationId: "replyToAgentRun",
  path: "/runs/{runId}/reply",
  tags: TAGS,
  summary: "Answer an agent's question",
  description:
    "Answer the question of a run that needs input. The same run continues with your answer. Only the person it asked; unanswered questions fail the run after 24 hours (NEEDS_INPUT_EXPIRED).",
  middleware: [workspaceAccess.fromBody(), requireAiUse] as const,
  request: { params: runIdParam, body: json(runReplyBody) },
  responses: {
    200: jsonResponse("The resumed run", startedRunSchema),
    403: forbidden,
    404: errorResponse("Run not found"),
    409: errorResponse("The run isn't waiting for an answer"),
  },
});

const followUpRoute = createRoute({
  method: "post",
  operationId: "followUpAgentRun",
  path: "/runs/{runId}/follow-up",
  tags: TAGS,
  summary: "Follow up on an agent run",
  description:
    "Chat with the agent: start a new run (trigger chat) of the same agent on the same task or project, with the earlier run's summary as context. The run acts for you. The run's person or ai:manage; the earlier run must have ended.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: { params: runIdParam, body: json(runFollowUpBody) },
  responses: {
    200: jsonResponse("The queued run", startedRunSchema),
    403: forbidden,
    404: errorResponse("Run not found"),
    409: errorResponse(
      "The run hasn't ended, the agent is off or gone, or the project is outside the agent's projects (code OUTSIDE_AGENT_PROJECTS)",
    ),
    429: errorResponse("AI_BUDGET_EXCEEDED: a budget is used up"),
  },
});

async function canManage(c: Parameters<typeof workspacePermissionChecker>[0]) {
  return (await workspacePermissionChecker(c))({ ai: ["manage"] });
}

const aiAgent = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(listAgentsRoute, async (c) =>
    c.json(await listAgents(c.get("workspaceId"), await canManage(c)), 200),
  )
  .openapi(templatesRoute, async (c) => c.json([...AGENT_TEMPLATES], 200))
  .openapi(listSchedulesRoute, async (c) =>
    c.json(
      await listSchedules(c.get("workspaceId"), c.req.valid("param").agentId),
      200,
    ),
  )
  .openapi(createScheduleRoute, async (c) => {
    const { workspaceId: _ignored, ...schedule } = c.req.valid("json");
    return c.json(
      await createSchedule({
        workspaceId: c.get("workspaceId"),
        agentId: c.req.valid("param").agentId,
        userId: c.get("userId"),
        schedule,
      }),
      200,
    );
  })
  .openapi(updateScheduleRoute, async (c) => {
    const { workspaceId: _ignored, ...patch } = c.req.valid("json");
    const param = c.req.valid("param");
    return c.json(
      await updateSchedule({
        workspaceId: c.get("workspaceId"),
        agentId: param.agentId,
        scheduleId: param.scheduleId,
        userId: c.get("userId"),
        patch,
      }),
      200,
    );
  })
  .openapi(deleteScheduleRoute, async (c) => {
    const param = c.req.valid("param");
    return c.json(
      await deleteSchedule({
        workspaceId: c.get("workspaceId"),
        agentId: param.agentId,
        scheduleId: param.scheduleId,
      }),
      200,
    );
  })
  .openapi(replyRoute, async (c) =>
    c.json(
      await replyToRun({
        workspaceId: c.get("workspaceId"),
        runId: c.req.valid("param").runId,
        userId: c.get("userId"),
        canManage: await canManage(c),
        text: c.req.valid("json").text,
      }),
      200,
    ),
  )
  .openapi(followUpRoute, async (c) =>
    c.json(
      await followUpRun({
        workspaceId: c.get("workspaceId"),
        runId: c.req.valid("param").runId,
        userId: c.get("userId"),
        canManage: await canManage(c),
        text: c.req.valid("json").text,
      }),
      200,
    ),
  )
  .openapi(createAgentRoute, async (c) => {
    const { workspaceId: _ignored, ...agent } = c.req.valid("json");
    return c.json(
      await createAgent({
        workspaceId: c.get("workspaceId"),
        actorId: c.get("userId"),
        instanceAdmin: await isInstanceAdmin(c),
        agent,
      }),
      200,
    );
  })
  .openapi(updateAgentRoute, async (c) => {
    const { workspaceId: _ignored, ...patch } = c.req.valid("json");
    return c.json(
      await updateAgent({
        workspaceId: c.get("workspaceId"),
        agentId: c.req.valid("param").agentId,
        actorId: c.get("userId"),
        instanceAdmin: await isInstanceAdmin(c),
        patch,
      }),
      200,
    );
  })
  .openapi(deleteAgentRoute, async (c) =>
    c.json(
      await deleteAgent({
        workspaceId: c.get("workspaceId"),
        agentId: c.req.valid("param").agentId,
      }),
      200,
    ),
  )
  .openapi(startRunRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await startManualRun({
        workspaceId: c.get("workspaceId"),
        agentId: c.req.valid("param").agentId,
        taskId: body.taskId,
        userId: c.get("userId"),
        prompt: body.prompt,
      }),
      200,
    );
  })
  .openapi(listRunsRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await listRuns({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        canManage: await canManage(c),
        agentId: query.agentId,
        taskId: query.taskId,
        status: query.status,
        before: query.before,
        limit: query.limit,
      }),
      200,
    );
  })
  .openapi(getRunRoute, async (c) =>
    c.json(
      await getRun({
        workspaceId: c.get("workspaceId"),
        runId: c.req.valid("param").runId,
        userId: c.get("userId"),
        canManage: await canManage(c),
      }),
      200,
    ),
  )
  .openapi(cancelRunRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const runId = c.req.valid("param").runId;
    const run = await cancelRun({
      workspaceId,
      runId,
      userId: c.get("userId"),
      canManage: await canManage(c),
    });
    await publishRunUpdated({
      workspaceId,
      runId,
      principalUserId: c.get("userId"),
      taskId: null,
      status: run.status,
    });
    return c.json({ id: run.id, status: run.status }, 200);
  })
  .openapi(undoRoute, async (c) =>
    c.json(
      await undoStep({
        workspaceId: c.get("workspaceId"),
        stepId: c.req.valid("param").stepId,
        userId: c.get("userId"),
        canManage: await canManage(c),
      }),
      200,
    ),
  )
  .openapi(listApprovalsRoute, async (c) =>
    c.json(await listMyApprovals(c.get("workspaceId"), c.get("userId")), 200),
  )
  .openapi(approveRoute, async (c) => {
    const result = await decideApproval({
      workspaceId: c.get("workspaceId"),
      approvalId: c.req.valid("param").approvalId,
      userId: c.get("userId"),
      decision: "approve",
    });
    return c.json(
      { id: result.id, status: result.status as "approved" | "rejected" },
      200,
    );
  })
  .openapi(rejectRoute, async (c) => {
    const result = await decideApproval({
      workspaceId: c.get("workspaceId"),
      approvalId: c.req.valid("param").approvalId,
      userId: c.get("userId"),
      decision: "reject",
    });
    return c.json(
      { id: result.id, status: result.status as "approved" | "rejected" },
      200,
    );
  });

export default aiAgent;
