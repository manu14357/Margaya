import type { AiStreamHandlers } from "@margaya/libs";
import { client } from "@margaya/libs";
import type { InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { streamAiRoute } from "../ai/ai";

// Planning insights (GET /api/insight/*): estimate suggestions and
// calibration, the cycle capacity check, retrospective facts and My brief,
// all computed; plus the optional AI narration (/api/ai/insight/*).

type InsightApi = (typeof client)["insight"];

export type EstimateSuggestion = InferResponseType<
  InsightApi["estimate"]["project"][":projectId"]["suggestion"]["$get"],
  200
>;
export type EstimateCalibration = InferResponseType<
  InsightApi["estimate"]["project"][":projectId"]["calibration"]["$get"],
  200
>;
export type CycleCapacity = InferResponseType<
  InsightApi["capacity"]["cycle"][":cycleId"]["$get"],
  200
>;
export type RetroFacts = InferResponseType<
  InsightApi["retro"]["cycle"][":cycleId"]["$get"],
  200
>;
export type MyBrief = InferResponseType<InsightApi["my-brief"]["$get"], 200>;

export type InsightCitation = {
  key: string;
  taskId: string;
  title: string;
  url: string;
};

async function read<T>(response: {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

export async function getEstimateSuggestion(
  projectId: string,
  taskId: string,
  signal?: AbortSignal,
) {
  return read<EstimateSuggestion>(
    await client.insight.estimate.project[":projectId"].suggestion.$get(
      { param: { projectId }, query: { taskId } },
      { init: { signal } },
    ),
  );
}

export async function getEstimateCalibration(
  projectId: string,
  signal?: AbortSignal,
) {
  return read<EstimateCalibration>(
    await client.insight.estimate.project[":projectId"].calibration.$get(
      { param: { projectId } },
      { init: { signal } },
    ),
  );
}

export async function getCycleCapacity(cycleId: string, signal?: AbortSignal) {
  return read<CycleCapacity>(
    await client.insight.capacity.cycle[":cycleId"].$get(
      { param: { cycleId } },
      { init: { signal } },
    ),
  );
}

export async function getRetroFacts(cycleId: string, signal?: AbortSignal) {
  return read<RetroFacts>(
    await client.insight.retro.cycle[":cycleId"].$get(
      { param: { cycleId } },
      { init: { signal } },
    ),
  );
}

export async function getMyBrief(workspaceId: string, signal?: AbortSignal) {
  return read<MyBrief>(
    await client.insight["my-brief"].$get(
      { query: { workspaceId } },
      { init: { signal } },
    ),
  );
}

type StreamOptions = AiStreamHandlers & { signal?: AbortSignal };

/** Streams a short explanation of a task's estimate suggestion. */
export function streamEstimateExplanation(
  body: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    locale?: string;
  },
  options: StreamOptions,
) {
  return streamAiRoute("/ai/insight/estimate", body, options);
}

/** Streams a cycle's retrospective narrative and discussion questions. */
export function streamRetroNarrative(
  body: { workspaceId: string; cycleId: string; locale?: string },
  options: StreamOptions,
) {
  return streamAiRoute("/ai/insight/retro", body, options);
}

/** Streams a short summary of the caller's brief. */
export function streamMyBriefSummary(
  body: { workspaceId: string; locale?: string },
  options: StreamOptions,
) {
  return streamAiRoute("/ai/insight/my-brief", body, options);
}

/** Streams a short digest of the caller's unread inbox. */
export function streamInboxDigest(
  body: { workspaceId: string; locale?: string },
  options: StreamOptions,
) {
  return streamAiRoute("/ai/insight/inbox-digest", body, options);
}

/** The citations a stream's meta event carries, if any. */
export function citationsOf(meta: unknown): InsightCitation[] {
  if (!meta || typeof meta !== "object") return [];
  const value = (meta as { citations?: unknown }).citations;
  return Array.isArray(value)
    ? value.filter(
        (item): item is InsightCitation =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as InsightCitation).key === "string" &&
          typeof (item as InsightCitation).url === "string",
      )
    : [];
}
