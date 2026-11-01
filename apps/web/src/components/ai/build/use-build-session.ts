import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyBuildChanges,
  type BuildAction,
  type BuildActionResult,
  type BuildContextItem,
  type BuildPlan,
  type BuildPlanContext,
  streamBuildPlan,
  undoBuildChange,
} from "@/fetchers/ai/chat-build";
import { agentKeys } from "@/hooks/queries/ai/use-agents";
import { aiErrorKey } from "@/lib/ai/format";
import { HttpError } from "@/lib/http-error";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

// One Build conversation in memory: each turn is a request, the plan the
// model proposed (edited by the person), and what applying it did. Nothing
// is stored; Undo tokens live only as long as the turn (and an hour).

export type BuildTurnStatus =
  | "planning"
  | "ready"
  | "applying"
  | "applied"
  | "cancelled"
  | "error";

export type BuildUndoState = "pending" | "done" | "error";

export type BuildTurn = {
  id: string;
  prompt: string;
  status: BuildTurnStatus;
  plan: BuildPlan["status"] | null;
  summary: string;
  /** The person's working copy; removed cards are gone from it. */
  actions: BuildAction[];
  question: { text: string; options: string[] } | null;
  truncated: boolean;
  /** Destructive actions the person ticked. */
  confirmed: string[];
  results: Record<string, BuildActionResult>;
  undo: Record<string, BuildUndoState>;
  autopilot: BuildPlan["autopilot"] | null;
  errorKey: string | null;
  /** When planning began (the live "Thinking…" count runs from it). */
  startedAt: number;
  /** What the plan was made from, once the server has read it. */
  context: BuildPlanContext | null;
  /** The model's reasoning text, when the instance shows it. */
  reasoning: string;
  /** How long it thought (or, without reasoning, planned); set when done. */
  reasoningMs: number | null;
};

const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_ANSWER_CHARS = 8_000;

function errorKeyOf(error: unknown): string {
  if (error instanceof HttpError && error.status === 403) {
    const key = aiErrorKey(error);
    return key === "ai:errors.unknown" ? "ai:build.chat.forbidden" : key;
  }
  return aiErrorKey(error);
}

/** Refreshes what applied (or undone) actions may have changed. */
function refreshAfterChanges(queryClient: QueryClient, workspaceId: string) {
  void invalidateTaskQueries(queryClient);
  for (const queryKey of [
    ["projects", workspaceId],
    ["tasks"],
    ["task"],
    ["cycles"],
    ["modules"],
    ["pages"],
    ["labels"],
    ["comments"],
    ["activities"],
    agentKeys.runs(workspaceId),
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** What earlier turns tell the planner (follow-ups like "also add…"). */
export function historyOf(turns: readonly BuildTurn[]) {
  return turns
    .filter((turn) => turn.status !== "planning" && turn.status !== "error")
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      question: turn.prompt,
      answer: [
        turn.summary,
        turn.question?.text ?? "",
        ...turn.actions.map((action) => {
          const result = turn.results[action.id];
          const state = result ? (result.ok ? "done" : "failed") : turn.status;
          return `- ${action.title} (${state})`;
        }),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, MAX_HISTORY_ANSWER_CHARS),
    }));
}

export function useBuildSession(input: {
  workspaceId: string | undefined;
  projectId: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [turns, setTurns] = useState<BuildTurn[]>([]);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const update = useCallback(
    (id: string, patch: (turn: BuildTurn) => Partial<BuildTurn>) => {
      setTurns((current) =>
        current.map((turn) =>
          turn.id === id ? { ...turn, ...patch(turn) } : turn,
        ),
      );
    },
    [],
  );

  const plan = useCallback(
    async (
      prompt: string,
      options: {
        history?: { question: string; answer: string }[];
        context?: BuildContextItem[];
        autopilot?: boolean;
      } = {},
    ) => {
      const text = prompt.trim();
      const workspaceId = input.workspaceId;
      if (!text || !workspaceId) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      nextId.current += 1;
      const id = `b${nextId.current}`;
      const history = options.history ?? historyOf(turnsRef.current);
      setTurns((current) => [
        ...current,
        {
          id,
          prompt: text,
          status: "planning",
          plan: null,
          summary: "",
          actions: [],
          question: null,
          truncated: false,
          confirmed: [],
          results: {},
          undo: {},
          autopilot: null,
          errorKey: null,
          startedAt: Date.now(),
          context: null,
          reasoning: "",
          reasoningMs: null,
        },
      ]);
      try {
        const result = await streamBuildPlan(
          {
            workspaceId,
            ...(input.projectId ? { projectId: input.projectId } : {}),
            prompt: text,
            ...(history.length > 0 ? { history } : {}),
            ...(options.context?.length ? { context: options.context } : {}),
            ...(options.autopilot ? { autopilot: true } : {}),
          },
          {
            signal: controller.signal,
            onContext: (context) => update(id, () => ({ context })),
            onReasoning: (delta) => {
              if (delta) {
                update(id, (turn) => ({ reasoning: turn.reasoning + delta }));
              }
            },
          },
        );
        const results = Object.fromEntries(
          (result.results ?? []).map((item) => [item.actionId, item]),
        );
        const applied = Boolean(result.autopilot?.applied);
        update(id, (turn) => ({
          status: applied ? "applied" : "ready",
          reasoningMs: result.reasoningMs ?? Date.now() - turn.startedAt,
          plan: result.status,
          summary: result.summary,
          actions: result.actions,
          question: result.question ?? null,
          truncated: result.truncated,
          autopilot: result.autopilot ?? null,
          results,
        }));
        if (applied) refreshAfterChanges(queryClient, workspaceId);
      } catch (error) {
        if (controller.signal.aborted) {
          update(id, () => ({ status: "cancelled" }));
          return;
        }
        update(id, () => ({ status: "error", errorKey: errorKeyOf(error) }));
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [input.workspaceId, input.projectId, queryClient, update],
  );

  const apply = useCallback(
    async (turnId: string) => {
      const workspaceId = input.workspaceId;
      const turn = turnsRef.current.find((item) => item.id === turnId);
      if (!workspaceId || !turn || turn.status !== "ready") return;
      const actions = turn.actions;
      if (actions.length === 0) return;
      update(turnId, () => ({ status: "applying", errorKey: null }));
      try {
        const { results } = await applyBuildChanges({
          workspaceId,
          actions,
          confirmDestructive: turn.confirmed,
        });
        update(turnId, () => ({
          status: "applied",
          results: Object.fromEntries(
            results.map((result) => [result.actionId, result]),
          ),
        }));
        refreshAfterChanges(queryClient, workspaceId);
      } catch (error) {
        update(turnId, () => ({
          status: "ready",
          errorKey: errorKeyOf(error),
        }));
      }
    },
    [input.workspaceId, queryClient, update],
  );

  const cancel = useCallback(
    (turnId: string) => {
      const turn = turnsRef.current.find((item) => item.id === turnId);
      if (turn?.status === "planning") controllerRef.current?.abort();
      update(turnId, (current) =>
        current.status === "planning" || current.status === "ready"
          ? { status: "cancelled" }
          : {},
      );
    },
    [update],
  );

  const undo = useCallback(
    async (turnId: string, actionId: string) => {
      const workspaceId = input.workspaceId;
      const turn = turnsRef.current.find((item) => item.id === turnId);
      const token = turn?.results[actionId]?.undoToken;
      if (!workspaceId || !token || turn.undo[actionId] === "pending") return;
      if (turn.undo[actionId] === "done") return;
      update(turnId, (current) => ({
        undo: { ...current.undo, [actionId]: "pending" },
      }));
      try {
        await undoBuildChange({ workspaceId, undoToken: token });
        update(turnId, (current) => ({
          undo: { ...current.undo, [actionId]: "done" },
        }));
        refreshAfterChanges(queryClient, workspaceId);
      } catch {
        update(turnId, (current) => ({
          undo: { ...current.undo, [actionId]: "error" },
        }));
      }
    },
    [input.workspaceId, queryClient, update],
  );

  /** Edits one card's params (and title) before confirming. */
  const editAction = useCallback(
    (turnId: string, actionId: string, next: BuildAction) => {
      update(turnId, (current) =>
        current.status === "ready"
          ? {
              actions: current.actions.map((action) =>
                action.id === actionId ? next : action,
              ),
            }
          : {},
      );
    },
    [update],
  );

  const removeAction = useCallback(
    (turnId: string, actionId: string) => {
      update(turnId, (current) =>
        current.status === "ready"
          ? {
              actions: current.actions.filter(
                (action) => action.id !== actionId,
              ),
              confirmed: current.confirmed.filter((id) => id !== actionId),
            }
          : {},
      );
    },
    [update],
  );

  const toggleConfirmed = useCallback(
    (turnId: string, actionId: string) => {
      update(turnId, (current) => ({
        confirmed: current.confirmed.includes(actionId)
          ? current.confirmed.filter((id) => id !== actionId)
          : [...current.confirmed, actionId],
      }));
    },
    [update],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setTurns([]);
  }, []);

  return {
    turns,
    busy: turns.some(
      (turn) => turn.status === "planning" || turn.status === "applying",
    ),
    plan,
    apply,
    cancel,
    undo,
    editAction,
    removeAction,
    toggleConfirmed,
    reset,
  };
}

export type BuildSession = ReturnType<typeof useBuildSession>;
