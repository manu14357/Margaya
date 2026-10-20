import type { AiStreamHandlers } from "@margaya/libs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AskSource, readAskSources, streamAsk } from "@/fetchers/ai/ask";
import { AI_ERROR_CODES } from "@/lib/ai/format";

export type AskTurnStatus = "streaming" | "done" | "stopped" | "error";

export const ASK_CONTEXT_KINDS = [
  "task",
  "page",
  "project",
  "cycle",
  "module",
  "user",
  "agent",
] as const;
export type AskContextKind = (typeof ASK_CONTEXT_KINDS)[number];

/** Something picked with "@": sent as `context`, shown as a chip. */
export type AskContextItem = {
  kind: AskContextKind;
  id: string;
  label: string;
  projectId?: string | null;
};

/** A file attached to a question; `data` is base64 and never saved. */
export type AskAttachment = {
  name: string;
  mediaType: string;
  data: string;
  size: number;
};

export type AskAnswerMeta = {
  provider: string;
  model: string;
  destination: string;
};

export type AskRating = 1 | -1;

/** One answer to a question; Regenerate adds another version. */
export type AskAnswerVersion = {
  answer: string;
  sources: AskSource[];
  /** Refs the server confirmed the answer cites. */
  citations: string[];
  noResults: boolean;
  status: AskTurnStatus;
  errorKey: string | null;
  /** Reasoning text, when the instance shows it; never saved. */
  reasoning: string;
  /** How long the model thought, from `done` (or measured here). */
  reasoningMs: number | null;
  /** When the model started thinking, while it still is (live timer). */
  thinkingSince: number | null;
  followUps: string[];
  meta: AskAnswerMeta | null;
  rating: AskRating | null;
};

export type AskRequestOptions = {
  context?: readonly AskContextItem[];
  attachments?: readonly AskAttachment[];
  webSearch?: boolean;
  skill?: { id: string; name: string } | null;
};

/** One exchange as the views read it: the question and its shown answer. */
export type AskTurn = AskAnswerVersion & {
  id: number;
  question: string;
  context: AskContextItem[];
  attachmentNames: string[];
  skillName: string | null;
  webSearch: boolean;
  /** A slash command's turn (a summary or a brief), not a question. */
  command: boolean;
  versionCount: number;
  versionIndex: number;
};

/** What a saved turn holds (history), without the reasoning text. */
export type AskTurnSnapshot = Pick<
  AskTurn,
  | "question"
  | "answer"
  | "sources"
  | "citations"
  | "noResults"
  | "errorKey"
  | "followUps"
  | "context"
> & {
  status: Exclude<AskTurnStatus, "streaming">;
  reasoningMs?: number | null;
  meta?: AskAnswerMeta | null;
};

/** Streams an answer into the handlers; a slash command brings its own. */
export type AskStreamer = (
  handlers: AiStreamHandlers & { signal: AbortSignal },
) => Promise<unknown>;

type RawTurn = {
  id: number;
  question: string;
  options: AskRequestOptions;
  /** A command's turn re-runs its own stream; a question asks again. */
  streamer: AskStreamer | null;
  command: boolean;
  versions: AskAnswerVersion[];
  active: number;
};

// What the API accepts as earlier turns (ai-ask/schema.ts).
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_ANSWER_CHARS = 8_000;
const MAX_FOLLOW_UPS = 3;

function errorKeyOf(code: string): string {
  if ((AI_ERROR_CODES as readonly string[]).includes(code)) {
    return `ai:errors.${code}`;
  }
  return code === "HTTP_403" ? "ai:ask.forbidden" : "ai:errors.unknown";
}

function emptyVersion(): AskAnswerVersion {
  return {
    answer: "",
    sources: [],
    citations: [],
    noResults: false,
    status: "streaming",
    errorKey: null,
    reasoning: "",
    reasoningMs: null,
    thinkingSince: null,
    followUps: [],
    meta: null,
    rating: null,
  };
}

function readMeta(value: unknown): AskAnswerMeta | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as Record<string, unknown>;
  if (typeof meta.model !== "string" || !meta.model) return null;
  return {
    provider: typeof meta.provider === "string" ? meta.provider : "",
    model: meta.model,
    destination: typeof meta.destination === "string" ? meta.destination : "",
  };
}

function readFollowUps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0 && item.length <= 200)
    .slice(0, MAX_FOLLOW_UPS);
}

/** Marks every answer still streaming as stopped. */
function stopStreaming(turns: RawTurn[]): RawTurn[] {
  return turns.map((turn) =>
    turn.versions.some((version) => version.status === "streaming")
      ? {
          ...turn,
          versions: turn.versions.map((version) =>
            version.status === "streaming"
              ? { ...version, status: "stopped" as const, thinkingSince: null }
              : version,
          ),
        }
      : turn,
  );
}

function view(turn: RawTurn): AskTurn {
  const version = turn.versions[turn.active] ?? emptyVersion();
  return {
    ...version,
    id: turn.id,
    question: turn.question,
    context: [...(turn.options.context ?? [])],
    attachmentNames: (turn.options.attachments ?? []).map((file) => file.name),
    skillName: turn.options.skill?.name ?? null,
    webSearch: turn.options.webSearch === true,
    command: turn.command,
    versionCount: turn.versions.length,
    versionIndex: turn.active,
  };
}

/**
 * One Ask conversation, kept in memory: earlier questions and answers go
 * back with each new question so follow-ups work. Asking again (or
 * unmounting) cancels a running answer. A question can be asked again
 * (Regenerate keeps every version) or edited, which drops what came after.
 */
export function useAskSession(input: {
  workspaceId: string | undefined;
  projectId: string | null;
  locale: string | undefined;
}) {
  const [raw, setRaw] = useState<RawTurn[]>([]);
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const controllerRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);

  const patchVersion = useCallback(
    (
      id: number,
      index: number,
      patch:
        | Partial<AskAnswerVersion>
        | ((version: AskAnswerVersion) => Partial<AskAnswerVersion>),
    ) => {
      setRaw((current) =>
        current.map((turn) => {
          if (turn.id !== id) return turn;
          const version = turn.versions[index];
          if (!version) return turn;
          const versions = [...turn.versions];
          versions[index] = {
            ...version,
            ...(typeof patch === "function" ? patch(version) : patch),
          };
          return { ...turn, versions };
        }),
      );
    },
    [],
  );

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRaw(stopStreaming);
  }, []);

  /** Earlier settled turns, as the API takes them. */
  const historyBefore = useCallback((turns: readonly RawTurn[]) => {
    return turns
      .map((turn) => ({ turn, version: turn.versions[turn.active] }))
      .filter(
        ({ version }) =>
          version?.status === "done" &&
          (version.answer.trim() || version.noResults),
      )
      .slice(-MAX_HISTORY_TURNS)
      .map(({ turn, version }) => ({
        question: turn.question,
        answer: (version?.answer ?? "").slice(0, MAX_HISTORY_ANSWER_CHARS),
      }));
  }, []);

  /** Streams into version `index` of turn `id`. */
  const run = useCallback(
    async (id: number, index: number, streamer: AskStreamer) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const live = () => controllerRef.current === controller;
      let failed = false;
      let finished = false;
      let noResults = false;
      let received = "";
      let thinkingStartedAt: number | null = null;
      let thinkingMs: number | null = null;
      const endThinking = () => {
        if (thinkingStartedAt !== null && thinkingMs === null) {
          thinkingMs = Date.now() - thinkingStartedAt;
        }
      };
      try {
        await streamer({
          signal: controller.signal,
          onMeta: (meta) => {
            if (!live()) return;
            patchVersion(id, index, {
              sources: readAskSources(meta.sources),
              meta: readMeta(meta),
            });
          },
          onEvent: (event, data) => {
            if (!live() || event !== "reasoning") return;
            const text =
              data && typeof data === "object"
                ? (data as { text?: unknown }).text
                : null;
            if (thinkingStartedAt === null) thinkingStartedAt = Date.now();
            const since = thinkingStartedAt;
            patchVersion(id, index, (version) => ({
              thinkingSince: version.answer ? null : since,
              reasoning:
                typeof text === "string"
                  ? version.reasoning + text
                  : version.reasoning,
            }));
          },
          onDelta: (delta) => {
            if (!live()) return;
            received += delta;
            endThinking();
            const measured = thinkingMs;
            patchVersion(id, index, (version) => ({
              answer: version.answer + delta,
              thinkingSince: null,
              reasoningMs: version.reasoningMs ?? measured,
            }));
          },
          onDone: (done) => {
            if (!live()) return;
            finished = true;
            endThinking();
            noResults = done.noResults === true;
            const serverMs =
              typeof done.reasoningMs === "number" &&
              Number.isFinite(done.reasoningMs) &&
              done.reasoningMs >= 0
                ? done.reasoningMs
                : null;
            const measured = thinkingMs;
            patchVersion(id, index, (version) => ({
              citations: Array.isArray(done.citations)
                ? done.citations.filter(
                    (ref): ref is string => typeof ref === "string",
                  )
                : version.citations,
              noResults,
              followUps: readFollowUps(done.followUps),
              reasoningMs: serverMs ?? version.reasoningMs ?? measured,
              thinkingSince: null,
            }));
          },
          onError: (error) => {
            if (!live()) return;
            failed = true;
            patchVersion(id, index, {
              status: "error",
              errorKey: errorKeyOf(error.code),
              thinkingSince: null,
            });
          },
        });
        if (live() && !failed) {
          // A stream that ends without `done`, or with nothing to show, is
          // a failed answer, never a blank one.
          const blank = !finished || (!received.trim() && !noResults);
          patchVersion(
            id,
            index,
            blank
              ? {
                  status: "error",
                  errorKey: "ai:errors.AI_PROVIDER_ERROR",
                  thinkingSince: null,
                }
              : { status: "done", thinkingSince: null },
          );
        }
      } catch {
        if (live() && !controller.signal.aborted) {
          patchVersion(id, index, {
            status: "error",
            errorKey: "ai:errors.unknown",
            thinkingSince: null,
          });
        }
      } finally {
        if (live()) controllerRef.current = null;
      }
    },
    [patchVersion],
  );

  const askStreamer = useCallback(
    (
      question: string,
      options: AskRequestOptions,
      earlier: readonly RawTurn[],
    ): AskStreamer | null => {
      const workspaceId = input.workspaceId;
      if (!workspaceId) return null;
      const history = historyBefore(earlier);
      const context = (options.context ?? []).map(({ kind, id }) => ({
        kind,
        id,
      }));
      const attachments = (options.attachments ?? []).map(
        ({ name, mediaType, data }) => ({ name, mediaType, data }),
      );
      const body: Parameters<typeof streamAsk>[0] = {
        workspaceId,
        question,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(history.length > 0 ? { history } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(context.length > 0 ? { context } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(options.webSearch ? { webSearch: true } : {}),
        ...(options.skill ? { skillId: options.skill.id } : {}),
      };
      return (handlers) => streamAsk(body, handlers);
    },
    [input.workspaceId, input.projectId, input.locale, historyBefore],
  );

  /** Adds a turn after `keep` (dropping later ones) and streams its answer. */
  const start = useCallback(
    (
      question: string,
      options: AskRequestOptions,
      streamer: AskStreamer,
      command: boolean,
      keep: readonly RawTurn[],
    ) => {
      nextId.current += 1;
      const id = nextId.current;
      const turn: RawTurn = {
        id,
        question,
        options,
        streamer: command ? streamer : null,
        command,
        versions: [emptyVersion()],
        active: 0,
      };
      setRaw([...stopStreaming([...keep]), turn]);
      return run(id, 0, streamer);
    },
    [run],
  );

  const ask = useCallback(
    async (question: string, options: AskRequestOptions = {}) => {
      const text = question.trim();
      if (!text) return;
      const streamer = askStreamer(text, options, rawRef.current);
      if (!streamer) return;
      await start(text, options, streamer, false, rawRef.current);
    },
    [askStreamer, start],
  );

  /**
   * A slash command's turn: `label` shows as the question and `streamer`
   * brings the answer (a summary, a brief).
   */
  const runCommand = useCallback(
    async (label: string, streamer: AskStreamer) => {
      if (!input.workspaceId) return;
      await start(label, {}, streamer, true, rawRef.current);
    },
    [input.workspaceId, start],
  );

  /** Asks a turn's question again, keeping the earlier answer as a version. */
  const regenerate = useCallback(
    async (id: number) => {
      const turns = rawRef.current;
      const position = turns.findIndex((turn) => turn.id === id);
      const turn = turns[position];
      if (!turn) return;
      const earlier = turns.slice(0, position);
      const streamer =
        turn.streamer ?? askStreamer(turn.question, turn.options, earlier);
      if (!streamer) return;
      const index = turn.versions.length;
      setRaw(
        stopStreaming(turns).map((item) =>
          item.id === id
            ? {
                ...item,
                versions: [...item.versions, emptyVersion()],
                active: index,
              }
            : item,
        ),
      );
      await run(id, index, streamer);
    },
    [askStreamer, run],
  );

  /** Replaces a question and asks it again; later turns are dropped. */
  const edit = useCallback(
    async (id: number, question: string) => {
      const text = question.trim();
      if (!text) return;
      const turns = rawRef.current;
      const position = turns.findIndex((turn) => turn.id === id);
      const turn = turns[position];
      if (!turn || turn.command) return;
      const earlier = turns.slice(0, position);
      const streamer = askStreamer(text, turn.options, earlier);
      if (!streamer) return;
      controllerRef.current?.abort();
      controllerRef.current = null;
      await start(text, turn.options, streamer, false, earlier);
    },
    [askStreamer, start],
  );

  const setVersion = useCallback((id: number, index: number) => {
    setRaw((current) =>
      current.map((turn) =>
        turn.id === id && index >= 0 && index < turn.versions.length
          ? { ...turn, active: index }
          : turn,
      ),
    );
  }, []);

  const rate = useCallback(
    (id: number, rating: AskRating | null) => {
      const turn = rawRef.current.find((item) => item.id === id);
      if (!turn) return;
      patchVersion(id, turn.active, { rating });
    },
    [patchVersion],
  );

  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRaw([]);
  }, []);

  /** Replaces the conversation, e.g. with one reopened from history. */
  const load = useCallback((saved: readonly AskTurnSnapshot[]) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setRaw(
      saved.map((turn) => {
        nextId.current += 1;
        return {
          id: nextId.current,
          question: turn.question,
          options: { context: turn.context ?? [] },
          streamer: null,
          command: false,
          versions: [
            {
              ...emptyVersion(),
              answer: turn.answer,
              sources: turn.sources,
              citations: turn.citations,
              noResults: turn.noResults,
              status: turn.status,
              errorKey: turn.errorKey,
              followUps: turn.followUps ?? [],
              reasoningMs: turn.reasoningMs ?? null,
              meta: turn.meta ?? null,
            },
          ],
          active: 0,
        };
      }),
    );
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const turns = useMemo(() => raw.map(view), [raw]);
  const streaming = raw.some((turn) =>
    turn.versions.some((version) => version.status === "streaming"),
  );
  return {
    turns,
    ask,
    runCommand,
    regenerate,
    edit,
    setVersion,
    rate,
    stop,
    clear,
    load,
    streaming,
  };
}
