import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// AI agents (C1–C3): the agents of a workspace, their runs (Agent Desk),
// approvals and undo.

type AgentsClient = (typeof client)["ai"]["agents"];

export type Agent = InferResponseType<AgentsClient["$get"], 200>[number];
export type AgentRun = InferResponseType<
  AgentsClient["runs"]["$get"],
  200
>[number];
export type AgentRunDetail = InferResponseType<
  AgentsClient["runs"][":runId"]["$get"],
  200
>;
export type AgentRunStep = AgentRunDetail["steps"][number];
export type AgentApproval = InferResponseType<
  AgentsClient["approvals"]["$get"],
  200
>[number];
export type CreateAgentInput = InferRequestType<AgentsClient["$post"]>["json"];
export type UpdateAgentInput = InferRequestType<
  AgentsClient[":agentId"]["$patch"]
>["json"];
export type AgentRunStatus = AgentRun["status"];

async function ok<T>(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<T>;
}): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getAgents(workspaceId: string) {
  return ok(await client.ai.agents.$get({ query: { workspaceId } }));
}

export async function createAgent(input: CreateAgentInput) {
  return ok(await client.ai.agents.$post({ json: input }));
}

export async function updateAgent(agentId: string, input: UpdateAgentInput) {
  return ok(
    await client.ai.agents[":agentId"].$patch({
      param: { agentId },
      json: input,
    }),
  );
}

export async function deleteAgent(workspaceId: string, agentId: string) {
  return ok(
    await client.ai.agents[":agentId"].$delete({
      param: { agentId },
      query: { workspaceId },
    }),
  );
}

export async function startAgentRun(input: {
  workspaceId: string;
  agentId: string;
  taskId: string;
  prompt: string;
}) {
  return ok(
    await client.ai.agents[":agentId"].runs.$post({
      param: { agentId: input.agentId },
      json: {
        workspaceId: input.workspaceId,
        taskId: input.taskId,
        prompt: input.prompt,
      },
    }),
  );
}

export async function getAgentRuns(input: {
  workspaceId: string;
  agentId?: string;
  taskId?: string;
  status?: AgentRunStatus;
}) {
  const query: Record<string, string> = { workspaceId: input.workspaceId };
  if (input.agentId) query.agentId = input.agentId;
  if (input.taskId) query.taskId = input.taskId;
  if (input.status) query.status = input.status;
  return ok(
    await client.ai.agents.runs.$get({
      query: query as { workspaceId: string },
    }),
  );
}

export async function getAgentRun(workspaceId: string, runId: string) {
  return ok(
    await client.ai.agents.runs[":runId"].$get({
      param: { runId },
      query: { workspaceId },
    }),
  );
}

export async function cancelAgentRun(workspaceId: string, runId: string) {
  return ok(
    await client.ai.agents.runs[":runId"].cancel.$post({
      param: { runId },
      json: { workspaceId },
    }),
  );
}

export async function undoAgentChange(workspaceId: string, stepId: string) {
  return ok(
    await client.ai.agents.steps[":stepId"].undo.$post({
      param: { stepId },
      json: { workspaceId },
    }),
  );
}

export async function getAgentApprovals(workspaceId: string) {
  return ok(await client.ai.agents.approvals.$get({ query: { workspaceId } }));
}

export async function decideAgentApproval(input: {
  workspaceId: string;
  approvalId: string;
  decision: "approve" | "reject";
}) {
  const route = client.ai.agents.approvals[":approvalId"];
  const args = {
    param: { approvalId: input.approvalId },
    json: { workspaceId: input.workspaceId },
  };
  return ok(
    input.decision === "approve"
      ? await route.approve.$post(args)
      : await route.reject.$post(args),
  );
}

export type AgentTemplate = InferResponseType<
  AgentsClient["templates"]["$get"],
  200
>[number];

/** Ready-made agents for the new-agent form (ai:manage). */
export async function getAgentTemplates(workspaceId: string) {
  return ok(await client.ai.agents.templates.$get({ query: { workspaceId } }));
}

/** Answers the question of a run that needs input; the run continues. */
export async function replyToAgentRun(input: {
  workspaceId: string;
  runId: string;
  text: string;
}) {
  return ok(
    await client.ai.agents.runs[":runId"].reply.$post({
      param: { runId: input.runId },
      json: { workspaceId: input.workspaceId, text: input.text },
    }),
  );
}

/** Chat with an agent: a follow-up run to a finished one. */
export async function followUpAgentRun(input: {
  workspaceId: string;
  runId: string;
  text: string;
}) {
  return ok(
    await client.ai.agents.runs[":runId"]["follow-up"].$post({
      param: { runId: input.runId },
      json: { workspaceId: input.workspaceId, text: input.text },
    }),
  );
}
