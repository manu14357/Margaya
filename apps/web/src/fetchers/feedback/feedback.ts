import { client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

// Product feedback from the signed-in person: availability, sending, the
// survey's check, snooze and preference, and a copy or deletion of what
// they sent. Everything stays on this instance.

export type FeedbackConfig = InferResponseType<
  typeof client.feedback.config.$get,
  200
>;
export type SubmitFeedbackInput = InferRequestType<
  typeof client.feedback.$post
>["json"];
export type OwnFeedback = InferResponseType<
  typeof client.feedback.mine.$get,
  200
>["items"][number];

async function ok<T extends Response>(response: T): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response;
}

export async function getFeedbackConfig() {
  const response = await ok(await client.feedback.config.$get());
  return (await response.json()) as FeedbackConfig;
}

export async function submitFeedback(json: SubmitFeedbackInput) {
  const response = await ok(await client.feedback.$post({ json }));
  return response.json();
}

export async function checkFeedbackSurvey() {
  const response = await ok(await client.feedback.survey.check.$post());
  return response.json();
}

export async function dismissFeedbackSurvey() {
  const response = await ok(await client.feedback.survey.dismiss.$post());
  return response.json();
}

export async function setFeedbackSurveyPreference(optedOut: boolean) {
  const response = await ok(
    await client.feedback.survey.preference.$put({ json: { optedOut } }),
  );
  return response.json();
}

export async function listOwnFeedback() {
  const response = await ok(await client.feedback.mine.$get());
  return response.json();
}

export async function deleteOwnFeedback() {
  const response = await ok(await client.feedback.mine.$delete());
  return response.json();
}
