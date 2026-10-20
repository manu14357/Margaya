import type { AiStreamHandlers } from "@margaya/libs";
import { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { streamAiRoute } from "./ai";

// Stakeholder briefs (B8): a status brief streamed from computed facts, and
// "shared" marks (saved as a page or copied) that the next brief diffs
// against.

type BriefClient = (typeof client)["ai"]["brief"];

export type BriefRequest = InferRequestType<BriefClient["$post"]>["json"];
export type BriefAudience = NonNullable<BriefRequest["audience"]>;
export type BriefScopeType = BriefRequest["scopeType"];

type BriefTask = { id: string; key: string; title: string; projectId: string };
type BriefTaskList = { total: number; tasks: BriefTask[] };

/**
 * The facts a brief was written from (the API's AiBriefFacts). The typed
 * client reads the route's stream type, so the shape is spelled out here.
 */
export type BriefFacts = {
  scope: {
    type: BriefScopeType;
    id: string;
    projectId: string;
    name: string;
    startDate: string | null;
    endDate: string | null;
  };
  generatedAt: string;
  since: string;
  truncated: boolean;
  counts: {
    total: number;
    backlog: number;
    unstarted: number;
    started: number;
    completed: number;
    cancelled: number;
  };
  percent: number;
  completed: BriefTaskList;
  added: BriefTaskList;
  removed: BriefTaskList;
  inProgress: BriefTaskList;
  risks: {
    kind: string;
    severity: "high" | "medium" | "low";
    total: number;
    tasks: BriefTask[];
  }[];
  forecast: {
    status: "ok" | "complete" | "insufficient_history";
    remaining: number;
    p50: string | null;
    p85: string | null;
    p95: string | null;
    probabilityByEnd: number | null;
  } | null;
  previous: {
    briefId: string;
    sharedAt: string;
    percent: number;
    forecastP85: string | null;
    risks: Record<string, number>;
  } | null;
};

export type BriefCitation = {
  key: string;
  taskId: string;
  title: string;
  url: string;
};

export type BriefMeta = {
  briefId: string;
  facts: BriefFacts;
  citations: BriefCitation[];
};

/** Whether a stream's meta event carries the brief's facts. */
export function isBriefMeta(meta: unknown): meta is BriefMeta {
  if (!meta || typeof meta !== "object") return false;
  const value = meta as Record<string, unknown>;
  return (
    typeof value.briefId === "string" &&
    typeof value.facts === "object" &&
    value.facts !== null &&
    Array.isArray(value.citations)
  );
}

export function streamBrief(
  body: BriefRequest,
  options: AiStreamHandlers & { signal?: AbortSignal },
) {
  return streamAiRoute("/ai/brief", body, options);
}

export async function shareBrief(input: { briefId: string; pageId?: string }) {
  const response = await client.ai.brief[":id"].share.$post({
    param: { id: input.briefId },
    json: input.pageId ? { pageId: input.pageId } : {},
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
