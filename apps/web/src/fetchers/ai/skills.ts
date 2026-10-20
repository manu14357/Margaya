import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { ok } from "./ai";

// Skills: saved, reusable prompts. Personal ones are seen by their author;
// shared ones by the whole workspace. Ask sends a skill's id with a question.

type SkillsClient = (typeof client)["ai"]["skills"];

export type AiSkill = InferResponseType<
  SkillsClient["$get"],
  200
>["skills"][number];
export type AiSkillInput = InferRequestType<SkillsClient["$post"]>["json"];
export type AiSkillPatch = InferRequestType<
  SkillsClient[":id"]["$patch"]
>["json"];

export async function listAiSkills(workspaceId: string) {
  const { skills } = await ok(
    await client.ai.skills.$get({ query: { workspaceId } }),
  );
  return skills;
}

export async function createAiSkill(input: AiSkillInput) {
  return ok(await client.ai.skills.$post({ json: input }));
}

export async function updateAiSkill(
  workspaceId: string,
  id: string,
  patch: AiSkillPatch,
) {
  return ok(
    await client.ai.skills[":id"].$patch({
      param: { id },
      query: { workspaceId },
      json: patch,
    }),
  );
}

export async function deleteAiSkill(workspaceId: string, id: string) {
  return ok(
    await client.ai.skills[":id"].$delete({
      param: { id },
      query: { workspaceId },
    }),
  );
}
