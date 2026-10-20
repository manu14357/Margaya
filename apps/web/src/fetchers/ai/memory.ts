import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { ok } from "./ai";

// Memory notes: short facts AI keeps in mind for a workspace, a project or
// one person ("Our release day is Thursday").

type MemoryClient = (typeof client)["ai"]["memory"];

export type AiMemoryNote = InferResponseType<
  MemoryClient["$get"],
  200
>["notes"][number];
export type AiMemoryScope = AiMemoryNote["scope"];
export type AiMemoryInput = InferRequestType<MemoryClient["$post"]>["json"];
export type AiMemoryPatch = InferRequestType<
  MemoryClient[":id"]["$patch"]
>["json"];

export async function listAiMemory(workspaceId: string) {
  const { notes } = await ok(
    await client.ai.memory.$get({ query: { workspaceId } }),
  );
  return notes;
}

export async function createAiMemory(input: AiMemoryInput) {
  return ok(await client.ai.memory.$post({ json: input }));
}

export async function updateAiMemory(
  workspaceId: string,
  id: string,
  patch: AiMemoryPatch,
) {
  return ok(
    await client.ai.memory[":id"].$patch({
      param: { id },
      query: { workspaceId },
      json: patch,
    }),
  );
}

export async function deleteAiMemory(workspaceId: string, id: string) {
  return ok(
    await client.ai.memory[":id"].$delete({
      param: { id },
      query: { workspaceId },
    }),
  );
}
