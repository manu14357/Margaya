import { type AiStreamError, client } from "@margaya/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import { streamAiRoute } from "./ai";

// Build mode in chat: plan (actions to review), apply what the person
// confirmed, and undo one applied action. Error bodies keep their raw text
// for aiErrorKey().

type ChatClient = (typeof client)["ai"]["chat"];

async function ok<T>(response: {
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

export type BuildPlanRequest = InferRequestType<
  ChatClient["plan"]["$post"]
>["json"];
// The 200 is also the SSE stream (declared as a string, returned as a raw
// Response); the JSON plan is what's left.
export type BuildPlan = Exclude<
  InferResponseType<ChatClient["plan"]["$post"], 200>,
  string | Response
>;
export type BuildAction = BuildPlan["actions"][number];
export type BuildActionOp = BuildAction["op"];
export type BuildProblem = NonNullable<BuildAction["problem"]>;
export type BuildApplyRequest = InferRequestType<
  ChatClient["apply"]["$post"]
>["json"];
export type BuildActionResult = InferResponseType<
  ChatClient["apply"]["$post"],
  200
>["results"][number];
export type BuildContextItem = NonNullable<BuildPlanRequest["context"]>[number];

export async function planBuildChanges(
  body: BuildPlanRequest,
  signal?: AbortSignal,
) {
  return ok<BuildPlan>(
    await client.ai.chat.plan.$post({ json: body }, { init: { signal } }),
  );
}

/** What a plan is being made from (the plan stream's `context` event). */
export type BuildPlanContext = {
  facts: { projects: number; tasks: number; members: number; cycles: number };
  items: { kind: string; title: string; url: string }[];
  memoryNotes: number;
  earlierTurns: number;
};

/**
 * planBuildChanges with the planning shown as it happens: what the plan
 * reads, then the model's reasoning ("" when the instance hides it). Fails
 * with the same HttpError, so error keys stay the same.
 */
export async function streamBuildPlan(
  body: BuildPlanRequest,
  handlers: {
    onContext?: (context: BuildPlanContext) => void;
    onReasoning?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<BuildPlan> {
  const out: { plan?: BuildPlan; error?: AiStreamError } = {};
  await streamAiRoute("/ai/chat/plan", body, {
    signal: handlers.signal,
    onEvent: (event, data) => {
      if (event === "context") handlers.onContext?.(data as BuildPlanContext);
      else if (event === "reasoning") {
        handlers.onReasoning?.((data as { text?: string }).text ?? "");
      }
    },
    onDone: (done) => {
      out.plan = done as unknown as BuildPlan;
    },
    onError: (error) => {
      out.error = error;
    },
  });
  if (out.plan) return out.plan;
  const error = out.error ?? { code: "AI_PROVIDER_ERROR", message: "" };
  throw new HttpError(
    error.status ?? 502,
    error.code.startsWith("HTTP_")
      ? error.message
      : JSON.stringify({ code: error.code, message: error.message }),
  );
}

export async function applyBuildChanges(body: BuildApplyRequest) {
  return ok<{ results: BuildActionResult[] }>(
    await client.ai.chat.apply.$post({ json: body }),
  );
}

export async function undoBuildChange(body: {
  workspaceId: string;
  undoToken: string;
}) {
  return ok<{ ok: true }>(await client.ai.chat.undo.$post({ json: body }));
}
