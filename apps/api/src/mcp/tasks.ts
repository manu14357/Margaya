import { CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/server";

// The MCP Tasks extension (io.modelcontextprotocol/tasks, MCP 2026-07-28)
// over Margaya agent runs. run_agent answers a client that declared the
// extension with a task handle instead of blocking; the client then polls
// tasks/get, answers the run's approvals and questions with tasks/update
// (they surface as input_required elicitations) and stops it with
// tasks/cancel. Every step calls the API's own agent routes with the
// caller's credential, so a client sees and decides exactly what its
// person may in the Margaya app. The handle carries the workspace and run
// ids and nothing else; any instance can serve it, as the state lives in
// PostgreSQL.

export const TASKS_EXTENSION = "io.modelcontextprotocol/tasks";
export const TASK_METHODS = new Set([
  "tasks/get",
  "tasks/update",
  "tasks/cancel",
]);
export const POLL_INTERVAL_MS = 3_000;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PREFIX = "agent-run.";

/** Whether the request's client declared the Tasks extension. */
export function clientSupportsTasks(extra: unknown): boolean {
  const envelope = (
    extra as { mcpReq?: { envelope?: Record<string, unknown> } }
  )?.mcpReq?.envelope;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as
    | { extensions?: Record<string, unknown> }
    | undefined;
  return Boolean(capabilities?.extensions?.[TASKS_EXTENSION]);
}

export function encodeTaskId(workspaceId: string, runId: string): string {
  return `${PREFIX}${workspaceId}.${runId}`;
}

export function decodeTaskId(
  taskId: unknown,
): { workspaceId: string; runId: string } | null {
  if (typeof taskId !== "string" || !taskId.startsWith(PREFIX)) return null;
  const [workspaceId, runId, ...rest] = taskId.slice(PREFIX.length).split(".");
  if (rest.length || !workspaceId || !runId) return null;
  if (!ID.test(workspaceId) || !ID.test(runId)) return null;
  return { workspaceId, runId };
}

type RunStep = {
  id: string;
  kind: string;
  toolName: string | null;
  change: Record<string, unknown> | null;
  approval: {
    id: string;
    status: string;
    canDecide: boolean;
  } | null;
};

export type AgentRunJson = {
  id: string;
  status: string;
  agent?: { name: string } | null;
  question?: { text: string; options: string[] } | null;
  error?: string | null;
  outputSummary?: string | null;
  appliedChanges?: number;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  steps?: RunStep[];
};

type ElicitRequest = {
  method: "elicitation/create";
  params: {
    mode: "form";
    message: string;
    requestedSchema: Record<string, unknown>;
  };
};

function approvalKey(approvalId: string) {
  return `approval:${approvalId}`;
}

/** Approvals of the run that wait for this caller. */
function decidable(run: AgentRunJson) {
  return (run.steps ?? []).filter(
    (step) => step.approval?.status === "pending" && step.approval.canDecide,
  );
}

function changeSummary(step: RunStep): string {
  const label =
    typeof step.change?.taskLabel === "string" ? step.change.taskLabel : "";
  return `${step.toolName ?? "change"}${label ? ` on ${label}` : ""}`.slice(
    0,
    300,
  );
}

/** A run as a Tasks-extension task (DetailedTask). */
export function runToTask(workspaceId: string, run: AgentRunJson) {
  const base = {
    taskId: encodeTaskId(workspaceId, run.id),
    createdAt: run.createdAt,
    lastUpdatedAt: run.finishedAt ?? run.startedAt ?? run.createdAt,
    ttlMs: null,
    pollIntervalMs: POLL_INTERVAL_MS,
  };
  const agent = run.agent?.name ?? "The agent";
  switch (run.status) {
    case "succeeded":
    case "failed": {
      const failed = run.status === "failed";
      const text = failed
        ? `The run failed${run.error ? ` (${run.error})` : ""}.`
        : run.outputSummary || "Done.";
      // A failed run is a tool-level error, not a JSON-RPC one: the task
      // completes with isError, as the spec asks.
      return {
        ...base,
        status: "completed" as const,
        statusMessage: failed ? "The run failed" : "The run finished",
        result: {
          content: [{ type: "text", text }],
          structuredContent: {
            runId: run.id,
            status: run.status,
            error: run.error ?? null,
            outputSummary: run.outputSummary ?? null,
            appliedChanges: run.appliedChanges ?? 0,
          },
          isError: failed,
        },
      };
    }
    case "cancelled":
      return {
        ...base,
        status: "cancelled" as const,
        statusMessage: "The run was cancelled",
      };
    case "awaiting_approval": {
      const pending = decidable(run);
      if (pending.length === 0) {
        return {
          ...base,
          status: "working" as const,
          statusMessage: "Waiting for a person's approval in Margaya",
        };
      }
      const inputRequests: Record<string, ElicitRequest> = {};
      for (const step of pending) {
        if (!step.approval) continue;
        inputRequests[approvalKey(step.approval.id)] = {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: `${agent} asks to apply: ${changeSummary(step)}. Approve it?`,
            requestedSchema: {
              type: "object",
              properties: {
                approve: {
                  type: "boolean",
                  title: "Approve",
                  description: "Yes applies the change; no discards it.",
                },
              },
              required: ["approve"],
            },
          },
        };
      }
      return {
        ...base,
        status: "input_required" as const,
        statusMessage: "Changes wait for your approval",
        inputRequests,
      };
    }
    case "needs_input": {
      if (!run.question) {
        return {
          ...base,
          status: "working" as const,
          statusMessage: "Waiting for an answer in Margaya",
        };
      }
      const options = run.question.options ?? [];
      return {
        ...base,
        status: "input_required" as const,
        statusMessage: "The agent has a question",
        inputRequests: {
          answer: {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: run.question.text,
              requestedSchema: {
                type: "object",
                properties: {
                  answer: {
                    type: "string",
                    title: "Answer",
                    maxLength: 4000,
                    ...(options.length
                      ? { description: `Suggested: ${options.join(", ")}` }
                      : {}),
                  },
                },
                required: ["answer"],
              },
            },
          },
        },
      };
    }
    default:
      return {
        ...base,
        status: "working" as const,
        statusMessage: run.status === "queued" ? "Queued" : "Working",
      };
  }
}

/** The CreateTaskResult run_agent returns to a client with the extension. */
export function createTaskResult(workspaceId: string, run: AgentRunJson) {
  return { resultType: "task" as const, ...runToTask(workspaceId, run) };
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number };

function agentApi(apiUrl: string, token: string) {
  return async <T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> => {
    const response = await fetch(`${apiUrl}/api/ai/agents${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status };
    }
    return { ok: true, data: (await response.json()) as T };
  };
}

type RpcRequest = { id?: unknown; method: string; params?: unknown };

type RpcResponse =
  | { jsonrpc: "2.0"; id: unknown; result: Record<string, unknown> }
  | {
      jsonrpc: "2.0";
      id: unknown;
      error: { code: number; message: string };
    };

const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function rpcError(id: unknown, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id: unknown, result: Record<string, unknown>): RpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    result: { resultType: "complete", ...result },
  };
}

type ElicitAnswer = {
  action?: unknown;
  content?: Record<string, unknown>;
};

/** Serves tasks/get, tasks/update and tasks/cancel for one caller. */
export async function handleTaskRequest(
  request: RpcRequest,
  token: string,
  apiUrl: string,
): Promise<RpcResponse> {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const handle = decodeTaskId(params.taskId);
  if (!handle) return rpcError(request.id, INVALID_PARAMS, "Unknown task");
  const api = agentApi(apiUrl, token);
  const workspace = encodeURIComponent(handle.workspaceId);
  const runPath = `/runs/${encodeURIComponent(handle.runId)}`;
  try {
    const current = await api<AgentRunJson>(
      "GET",
      `${runPath}?workspaceId=${workspace}`,
    );
    // Someone else's run, a hidden project or a gone run all read the same.
    if (!current.ok) {
      return current.status >= 500
        ? rpcError(request.id, INTERNAL_ERROR, "Margaya could not do that")
        : rpcError(request.id, INVALID_PARAMS, "Unknown task");
    }
    const run = current.data;
    switch (request.method) {
      case "tasks/get":
        return rpcResult(request.id, runToTask(handle.workspaceId, run));
      case "tasks/cancel": {
        // Cooperative: a run that already ended is acknowledged too.
        await api("POST", `${runPath}/cancel`, {
          workspaceId: handle.workspaceId,
        });
        return rpcResult(request.id, {});
      }
      case "tasks/update": {
        const responses = params.inputResponses;
        if (!responses || typeof responses !== "object") {
          return rpcError(request.id, INVALID_PARAMS, "inputResponses missing");
        }
        const answers = responses as Record<string, ElicitAnswer>;
        // Only keys this run is waiting on count; others are ignored.
        for (const step of decidable(run)) {
          if (!step.approval) continue;
          const answer = answers[approvalKey(step.approval.id)];
          if (!answer || answer.action === "cancel") continue;
          const approve =
            answer.action === "accept" && answer.content?.approve === true;
          await api(
            "POST",
            `/approvals/${encodeURIComponent(step.approval.id)}/${approve ? "approve" : "reject"}`,
            { workspaceId: handle.workspaceId },
          );
        }
        const reply = answers.answer;
        const text = reply?.content?.answer;
        if (
          run.status === "needs_input" &&
          run.question &&
          reply?.action === "accept" &&
          typeof text === "string" &&
          text.trim()
        ) {
          await api("POST", `${runPath}/reply`, {
            workspaceId: handle.workspaceId,
            text: text.trim().slice(0, 4_000),
          });
        }
        return rpcResult(request.id, {});
      }
    }
    return rpcError(request.id, -32601, "Method not found");
  } catch {
    return rpcError(request.id, INTERNAL_ERROR, "Margaya could not do that");
  }
}
