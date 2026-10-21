import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Coding-agent handoff (C4): profiles (workspace settings), a task's
// handoffs and repositories, the brief, and sending.

type CodingAgentClient = (typeof client)["coding-agent"];

export type CodingAgentProfileList = InferResponseType<
  CodingAgentClient["profiles"]["$get"],
  200
>;
export type CodingAgentProfile = CodingAgentProfileList["profiles"][number];

export type CodingAgentTask = InferResponseType<
  CodingAgentClient["task"][":taskId"]["$get"],
  200
>;
export type CodingHandoff = CodingAgentTask["handoffs"][number];
export type CodingAgentRepository = CodingAgentTask["repositories"][number];

export type CodingAgentBrief = InferResponseType<
  CodingAgentClient["task"][":taskId"]["brief"]["$post"],
  200
>;

export type CodingAgentSendResult = InferResponseType<
  CodingAgentClient["task"][":taskId"]["send"]["$post"],
  200
>;

async function read<T>(response: {
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

export async function getCodingAgentProfiles(
  workspaceId: string,
): Promise<CodingAgentProfileList> {
  return read(
    await client["coding-agent"].profiles.$get({ query: { workspaceId } }),
  );
}

export async function createCodingAgentProfile(input: {
  workspaceId: string;
  name: string;
  mention?: string;
  assignee?: string | null;
}): Promise<CodingAgentProfile> {
  return read(await client["coding-agent"].profiles.$post({ json: input }));
}

export async function updateCodingAgentProfile(input: {
  workspaceId: string;
  id: string;
  name?: string;
  mention?: string;
  assignee?: string | null;
  enabled?: boolean;
}): Promise<CodingAgentProfile> {
  const { workspaceId, id, ...json } = input;
  return read(
    await client["coding-agent"].profiles[":id"].$patch({
      param: { id },
      query: { workspaceId },
      json,
    }),
  );
}

export async function deleteCodingAgentProfile(input: {
  workspaceId: string;
  id: string;
}): Promise<{ id: string; deleted: true }> {
  return read(
    await client["coding-agent"].profiles[":id"].$delete({
      param: { id: input.id },
      query: { workspaceId: input.workspaceId },
    }),
  );
}

export async function getTaskCodingAgents(
  taskId: string,
): Promise<CodingAgentTask> {
  return read(
    await client["coding-agent"].task[":taskId"].$get({ param: { taskId } }),
  );
}

export async function prepareCodingAgentBrief(input: {
  taskId: string;
  integrationId: string;
  useAi: boolean;
  locale?: string;
}): Promise<CodingAgentBrief> {
  const { taskId, ...json } = input;
  const response = await client["coding-agent"].task[":taskId"].brief.$post({
    param: { taskId },
    json,
  });
  // AI failures answer JSON {code, message}; HttpError keeps the body so
  // aiErrorKey can map the code.
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as CodingAgentBrief;
}

export async function sendToCodingAgent(input: {
  taskId: string;
  integrationId: string;
  profileId: string;
  title: string;
  brief: string;
}): Promise<CodingAgentSendResult> {
  const { taskId, ...json } = input;
  return read(
    await client["coding-agent"].task[":taskId"].send.$post({
      param: { taskId },
      json,
    }),
  );
}
