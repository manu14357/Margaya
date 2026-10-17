import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// The caller's own API keys: scopes and the per-key request log. Revoking
// stays on Better Auth's client (authClient.apiKey.delete).

export type CreateApiKeyInput = InferRequestType<
  (typeof client)["api-key"]["$post"]
>["json"];

export async function listApiKeys() {
  const response = await client["api-key"].$get();
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function createApiKey(json: CreateApiKeyInput) {
  const response = await client["api-key"].$post({ json });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function listApiKeyRequests(
  id: string,
  query: { cursor?: string; limit?: number },
) {
  const response = await client["api-key"][":id"].requests.$get({
    param: { id },
    query: {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: String(query.limit ?? 50),
    },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
