import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { ok } from "./ai";

// Agent schedules: run an agent with a prompt on a cron schedule in a time
// zone (ai:manage). Runs act for whoever last saved the schedule.

type ScheduleClient = (typeof client)["ai"]["agents"][":agentId"]["schedules"];

export type AgentSchedule = InferResponseType<
  ScheduleClient["$get"],
  200
>[number];
export type CreateAgentScheduleInput = InferRequestType<
  ScheduleClient["$post"]
>["json"];
export type UpdateAgentScheduleInput = InferRequestType<
  ScheduleClient[":scheduleId"]["$patch"]
>["json"];

export async function getAgentSchedules(workspaceId: string, agentId: string) {
  return ok(
    await client.ai.agents[":agentId"].schedules.$get({
      param: { agentId },
      query: { workspaceId },
    }),
  );
}

export async function createAgentSchedule(
  agentId: string,
  input: CreateAgentScheduleInput,
) {
  return ok(
    await client.ai.agents[":agentId"].schedules.$post({
      param: { agentId },
      json: input,
    }),
  );
}

export async function updateAgentSchedule(
  agentId: string,
  scheduleId: string,
  input: UpdateAgentScheduleInput,
) {
  return ok(
    await client.ai.agents[":agentId"].schedules[":scheduleId"].$patch({
      param: { agentId, scheduleId },
      json: input,
    }),
  );
}

export async function deleteAgentSchedule(
  workspaceId: string,
  agentId: string,
  scheduleId: string,
) {
  return ok(
    await client.ai.agents[":agentId"].schedules[":scheduleId"].$delete({
      param: { agentId, scheduleId },
      query: { workspaceId },
    }),
  );
}
