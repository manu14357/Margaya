import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Capture to issue (C6): screenshots, recording frames or a transcript in,
// proposed intake requests out. Nothing is created by asking.

type CaptureRoute = (typeof client)["ai"]["capture"][":projectId"]["$post"];

export type CaptureResult = InferResponseType<CaptureRoute, 200>;
export type CaptureProposal = CaptureResult["items"][number];
export type CaptureInput = InferRequestType<CaptureRoute>["json"];

export async function analyzeCapture(input: {
  projectId: string;
  body: CaptureInput;
}): Promise<CaptureResult> {
  const response = await client.ai.capture[":projectId"].$post({
    param: { projectId: input.projectId },
    json: input.body,
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
