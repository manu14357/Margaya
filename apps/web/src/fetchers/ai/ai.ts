import {
  type AiStreamHandlers,
  client,
  resolveApiBaseUrl,
  streamAi,
  windowId,
} from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// The AI foundation routes: availability, workspace settings, connection
// tests and the usage ledger. AI features add their own fetchers next to
// this file; streaming routes go through `streamAiRoute`.

/** The JSON of an ok response; otherwise an HttpError with the body. */
export async function ok<T>(response: {
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

export async function getAiAvailability(
  workspaceId: string,
  projectId?: string,
) {
  const response = await client.ai.availability.$get({
    query: projectId ? { workspaceId, projectId } : { workspaceId },
  });
  return ok(response);
}

export type AiAvailability = InferResponseType<
  typeof client.ai.availability.$get,
  200
>;

export async function getAiSettings(workspaceId: string) {
  return ok(await client.ai.settings.$get({ query: { workspaceId } }));
}

export type AiSettings = InferResponseType<typeof client.ai.settings.$get, 200>;

export type AiSettingsPatch = InferRequestType<
  typeof client.ai.settings.$patch
>["json"];

export async function updateAiSettings(patch: AiSettingsPatch) {
  return ok(await client.ai.settings.$patch({ json: patch }));
}

export async function testAiConnection(workspaceId: string) {
  return ok(await client.ai.settings.test.$post({ json: { workspaceId } }));
}

export type AiTestResult = InferResponseType<
  typeof client.ai.settings.test.$post,
  200
>;

export async function getAiUsage(input: {
  workspaceId: string;
  from?: string;
  to?: string;
}) {
  return ok(await client.ai.usage.$get({ query: input }));
}

export type AiUsage = InferResponseType<typeof client.ai.usage.$get, 200>;

/** The workspace's usage ledger for a range as a CSV file's text. */
export async function exportAiUsageCsv(input: {
  workspaceId: string;
  from?: string;
  to?: string;
}): Promise<string> {
  const response = await client.ai.usage.export.$get({ query: input });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.text();
}

export async function getInstanceAiStatus() {
  return ok(await client.ai.instance.status.$get());
}

export async function testInstanceAiConnection(
  target: "cloud" | "local" | "speech",
) {
  return ok(await client.ai.instance.test.$post({ json: { target } }));
}

export async function getInstanceAiUsage(input: {
  from?: string;
  to?: string;
}) {
  return ok(await client.ai.instance.usage.$get({ query: input }));
}

export type InstanceAiUsage = InferResponseType<
  typeof client.ai.instance.usage.$get,
  200
>;

/**
 * Streams an AI route's answer (Server-Sent Events). Resolves with the full
 * text; errors arrive through `onError` with the API's AI error code.
 */
export function streamAiRoute(
  path: string,
  body: unknown,
  handlers: AiStreamHandlers & { signal?: AbortSignal },
) {
  return streamAi({
    apiUrl: resolveApiBaseUrl(import.meta.env.VITE_API_URL),
    path,
    body,
    windowId,
    ...handlers,
  });
}
