import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { ok } from "./ai";

// An agent's intake trigger: run on every new intake request in its
// projects (ai:manage). Runs act for whoever last turned it on.

type IntakeTriggerClient =
  (typeof client)["ai"]["agents"][":agentId"]["intake-trigger"];

export type SetAgentIntakeTriggerInput = InferRequestType<
  IntakeTriggerClient["$patch"]
>["json"];

export async function setAgentIntakeTrigger(
  agentId: string,
  input: SetAgentIntakeTriggerInput,
) {
  return ok(
    await client.ai.agents[":agentId"]["intake-trigger"].$patch({
      param: { agentId },
      json: input,
    }),
  );
}
