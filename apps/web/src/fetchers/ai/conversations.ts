import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Ask conversations kept on the server: only when the workspace turns on
// server-side chat history (otherwise the API answers 403 AI_HISTORY_OFF and
// history stays in the browser).

type ConversationsClient = (typeof client)["ai"]["conversations"];

export type ServerConversationSummary = InferResponseType<
  ConversationsClient["$get"],
  200
>["conversations"][number];
export type ServerConversation = InferResponseType<
  ConversationsClient[":id"]["$get"],
  200
>;
export type ServerConversationInput = InferRequestType<
  ConversationsClient[":id"]["$put"]
>["json"];

async function fail(response: { status: number; text(): Promise<string> }) {
  return new HttpError(response.status, await response.text());
}

export async function listConversations(workspaceId: string) {
  const response = await client.ai.conversations.$get({
    query: { workspaceId },
  });
  if (!response.ok) throw await fail(response);
  return (await response.json()).conversations;
}

export async function getConversation(workspaceId: string, id: string) {
  const response = await client.ai.conversations[":id"].$get({
    param: { id },
    query: { workspaceId },
  });
  if (!response.ok) throw await fail(response);
  return response.json();
}

export async function saveConversation(
  id: string,
  input: ServerConversationInput,
) {
  const response = await client.ai.conversations[":id"].$put({
    param: { id },
    json: input,
  });
  if (!response.ok) throw await fail(response);
  return response.json();
}

export async function updateConversation(
  workspaceId: string,
  id: string,
  patch: { title?: string; pinned?: boolean },
) {
  const response = await client.ai.conversations[":id"].$patch({
    param: { id },
    query: { workspaceId },
    json: patch,
  });
  if (!response.ok) throw await fail(response);
  return response.json();
}

export async function deleteConversation(workspaceId: string, id: string) {
  const response = await client.ai.conversations[":id"].$delete({
    param: { id },
    query: { workspaceId },
  });
  if (!response.ok) throw await fail(response);
  return response.json();
}
