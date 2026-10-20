import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Triage Copilot (B7): suggestions for a task or an intake request, and the
// project's opt-in to apply suggested labels at once.

type TriageClient = (typeof client)["ai"]["triage"];

export type TriageSuggestions = InferResponseType<
  TriageClient["suggest"]["$post"],
  200
>;

export type TriageSettings = InferResponseType<
  TriageClient["settings"][":projectId"]["$get"],
  200
>;

export async function suggestTriage(input: {
  taskId: string;
  locale?: string;
}): Promise<TriageSuggestions> {
  const response = await client.ai.triage.suggest.$post({
    json: input.locale
      ? { taskId: input.taskId, locale: input.locale }
      : { taskId: input.taskId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function getTriageSettings(
  projectId: string,
): Promise<TriageSettings> {
  const response = await client.ai.triage.settings[":projectId"].$get({
    param: { projectId },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export async function updateTriageSettings(input: {
  projectId: string;
  autoApplyLabels: boolean;
}): Promise<TriageSettings> {
  const response = await client.ai.triage.settings[":projectId"].$patch({
    param: { projectId: input.projectId },
    json: { autoApplyLabels: input.autoApplyLabels },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}

export type DraftLabelsRequest = InferRequestType<
  TriageClient["labels"]["$post"]
>["json"];
export type DraftLabelSuggestions = InferResponseType<
  TriageClient["labels"]["$post"],
  200
>;

/** Labels for a task still being written (the create dialog). */
export async function suggestDraftLabels(
  input: DraftLabelsRequest,
  signal?: AbortSignal,
): Promise<DraftLabelSuggestions> {
  const response = await client.ai.triage.labels.$post(
    { json: input },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
