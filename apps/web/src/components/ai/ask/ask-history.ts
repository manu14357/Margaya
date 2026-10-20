import { readAskSources } from "@/fetchers/ai/ask";
import {
  ASK_CONTEXT_KINDS,
  type AskAnswerMeta,
  type AskContextItem,
  type AskTurn,
  type AskTurnSnapshot,
} from "./use-ask-session";

/**
 * Ask conversations saved in this browser. Unless a workspace turns on
 * server-side chat history, Margaya never stores prompts or answers on the
 * server, so history lives in localStorage, one entry per person and
 * workspace. Storage can be missing, full or blocked (private
 * windows, quotas), so every access is guarded and Ask works without it.
 */

const PREFIX = "margaya:ask-history:v1:";
/** Server mode: the open conversation's id (use-ask-history.ts). */
export const CURRENT_PREFIX = "margaya:ask-current:v1:";
export const MAX_CONVERSATIONS = 50;
const MAX_TURNS = 50;

export const MAX_TITLE_CHARS = 120;

type StoredStatus = AskTurnSnapshot["status"];

export type StoredTurn = AskTurnSnapshot;

export type AskConversation = {
  id: string;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
  /** A name the person gave it; otherwise the first question names it. */
  title: string | null;
  pinned: boolean;
  turns: StoredTurn[];
};

/** The name a conversation shows: its own title or its first question. */
export function conversationTitle(conversation: {
  title: string | null;
  turns?: readonly { question: string }[];
}): string {
  return (
    conversation.title?.trim() ||
    conversation.turns?.[0]?.question.slice(0, MAX_TITLE_CHARS) ||
    ""
  );
}

export type AskHistory = {
  conversations: AskConversation[];
  currentId: string | null;
};

const EMPTY: AskHistory = { conversations: [], currentId: null };
const STATUSES: readonly string[] = ["done", "stopped", "error"];

export function historyKey(userId: string, workspaceId: string) {
  return `${PREFIX}${userId}:${workspaceId}`;
}

export function newConversationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readContext(value: unknown): AskContextItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const entry = item as Record<string, unknown>;
    if (
      !(ASK_CONTEXT_KINDS as readonly unknown[]).includes(entry.kind) ||
      typeof entry.id !== "string" ||
      typeof entry.label !== "string"
    ) {
      return [];
    }
    return [
      {
        kind: entry.kind as AskContextItem["kind"],
        id: entry.id,
        label: entry.label,
        projectId: typeof entry.projectId === "string" ? entry.projectId : null,
      },
    ];
  });
}

function readMeta(value: unknown): AskAnswerMeta | null {
  if (typeof value !== "object" || value === null) return null;
  const meta = value as Record<string, unknown>;
  if (typeof meta.model !== "string") return null;
  return {
    model: meta.model,
    provider: typeof meta.provider === "string" ? meta.provider : "",
    destination: typeof meta.destination === "string" ? meta.destination : "",
  };
}

/** A saved turn, or null when it isn't one (storage or server data). */
export function readTurn(value: unknown): StoredTurn | null {
  if (typeof value !== "object" || value === null) return null;
  const turn = value as Record<string, unknown>;
  if (typeof turn.question !== "string" || !turn.question.trim()) return null;
  const reasoningMs = Number(turn.reasoningMs);
  return {
    question: turn.question,
    answer: typeof turn.answer === "string" ? turn.answer : "",
    sources: readAskSources(turn.sources),
    citations: strings(turn.citations),
    noResults: turn.noResults === true,
    status: STATUSES.includes(turn.status as string)
      ? (turn.status as StoredStatus)
      : "done",
    errorKey: typeof turn.errorKey === "string" ? turn.errorKey : null,
    followUps: strings(turn.followUps).slice(0, 3),
    context: readContext(turn.context),
    reasoningMs:
      turn.reasoningMs !== null &&
      Number.isFinite(reasoningMs) &&
      reasoningMs >= 0
        ? reasoningMs
        : null,
    meta: readMeta(turn.meta),
  };
}

function readConversation(value: unknown): AskConversation | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !Array.isArray(item.turns)) return null;
  const turns = item.turns.flatMap((turn) => readTurn(turn) ?? []);
  if (turns.length === 0) return null;
  const updatedAt = Number(item.updatedAt) || 0;
  const title =
    typeof item.title === "string" && item.title.trim()
      ? item.title.trim().slice(0, MAX_TITLE_CHARS)
      : null;
  return {
    id: item.id,
    projectId: typeof item.projectId === "string" ? item.projectId : null,
    createdAt: Number(item.createdAt) || updatedAt,
    updatedAt,
    title,
    pinned: item.pinned === true,
    turns,
  };
}

/** The saved history, or an empty one when storage is unreadable. */
export function readHistory(key: string): AskHistory {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations
          .flatMap((item) => readConversation(item) ?? [])
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, MAX_CONVERSATIONS)
      : [];
    const currentId =
      typeof parsed.currentId === "string" &&
      conversations.some((item) => item.id === parsed.currentId)
        ? parsed.currentId
        : null;
    return { conversations, currentId };
  } catch {
    return EMPTY;
  }
}

/**
 * Saves `history`, newest first and capped. When the browser's quota is
 * full, older conversations are dropped until it fits; it never throws.
 */
export function writeHistory(key: string, history: AskHistory): AskHistory {
  const conversations = [...history.conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  const store = storage();
  for (let keep = conversations.length; store && keep > 0; ) {
    const kept = conversations.slice(0, keep);
    const next = {
      conversations: kept,
      currentId: kept.some((item) => item.id === history.currentId)
        ? history.currentId
        : null,
    };
    try {
      store.setItem(key, JSON.stringify(next));
      return next;
    } catch {
      keep = Math.floor(keep / 2);
    }
  }
  // Nothing to keep, or nothing fits: remove what is stored so a deleted
  // conversation never comes back, and keep the rest for this session only.
  try {
    store?.removeItem(key);
  } catch {
    // Storage is unavailable.
  }
  return { conversations, currentId: history.currentId };
}

/** Removes every saved Ask conversation in this browser (sign-out). */
export function clearAllAskHistory() {
  try {
    const store = storage();
    if (!store) return;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(PREFIX) || key?.startsWith(CURRENT_PREFIX)) {
        keys.push(key);
      }
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage is unavailable: nothing was saved.
  }
}

/**
 * Settled turns as saved, each with the answer it shows; a turn still
 * streaming is saved as stopped. Reasoning text is never saved.
 */
export function toStoredTurns(turns: readonly AskTurn[]): StoredTurn[] {
  return turns.slice(-MAX_TURNS).map((turn) => ({
    question: turn.question,
    answer: turn.answer,
    sources: turn.sources,
    citations: turn.citations,
    noResults: turn.noResults,
    status: turn.status === "streaming" ? "stopped" : turn.status,
    errorKey: turn.errorKey,
    followUps: turn.followUps,
    context: turn.context,
    reasoningMs: turn.reasoningMs,
    meta: turn.meta,
  }));
}

/**
 * The conversation as Markdown: each question, then its answer. Citation
 * tokens and charts are converted by the caller (answerForCopy).
 */
export function conversationMarkdown(
  title: string,
  turns: readonly { question: string; answer: string }[],
  labels: { you: string; answer: string },
): string {
  const parts = turns.map((turn) =>
    [
      `**${labels.you}:** ${turn.question.replace(/\s*\n+\s*/g, " ")}`,
      "",
      `**${labels.answer}:**`,
      "",
      turn.answer.trim(),
    ].join("\n"),
  );
  return [`# ${title}`, ...parts].join("\n\n---\n\n").trim();
}
