import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteConversation,
  getConversation,
  saveConversation,
  updateConversation,
} from "@/fetchers/ai/conversations";
import { aiKeys } from "@/hooks/queries/ai/use-ai";
import { useAiConversations } from "@/hooks/queries/ai/use-ai-assistant";
import {
  type AskConversation,
  type AskHistory,
  CURRENT_PREFIX,
  conversationTitle,
  historyKey,
  MAX_TITLE_CHARS,
  readHistory,
  readTurn,
  writeHistory,
} from "./ask-history";

const EMPTY: AskHistory = { conversations: [], currentId: null };

/** A conversation as the history list shows it. */
export type AskConversationSummary = {
  id: string;
  projectId: string | null;
  updatedAt: number;
  title: string;
  pinned: boolean;
};

function timeOf(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function readServerSummary(
  value: unknown,
): AskConversationSummary | null {
  const item = record(value);
  if (!item || typeof item.id !== "string") return null;
  return {
    id: item.id,
    projectId: typeof item.projectId === "string" ? item.projectId : null,
    updatedAt: timeOf(item.updatedAt),
    title: typeof item.title === "string" ? item.title : "",
    pinned: item.pinned === true,
  };
}

export function readServerConversation(value: unknown): AskConversation | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || !Array.isArray(item.turns)) {
    return null;
  }
  const updatedAt = timeOf(item.updatedAt);
  return {
    id: item.id,
    projectId: typeof item.projectId === "string" ? item.projectId : null,
    createdAt: timeOf(item.createdAt) || updatedAt,
    updatedAt,
    title: typeof item.title === "string" && item.title ? item.title : null,
    pinned: item.pinned === true,
    turns: item.turns.flatMap((turn) => readTurn(turn) ?? []),
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readCurrent(key: string): string | null {
  try {
    return storage()?.getItem(`${CURRENT_PREFIX}${key}`) ?? null;
  } catch {
    return null;
  }
}

function writeCurrent(key: string, id: string | null) {
  try {
    if (id) storage()?.setItem(`${CURRENT_PREFIX}${key}`, id);
    else storage()?.removeItem(`${CURRENT_PREFIX}${key}`);
  } catch {
    // Storage is unavailable: the next visit starts a new conversation.
  }
}

/** Pinned first, then the most recently updated. */
function ordered<T extends { pinned: boolean; updatedAt: number }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}

/**
 * The saved Ask conversations of the signed-in person in one workspace: in
 * this browser, or on the server while the workspace keeps chat history
 * there (`server`). Nothing is read or written without both ids (signed
 * out, loading). `loadedKey` says which history is loaded, so callers can
 * restore once per person, workspace and mode.
 */
export function useAskHistory(input: {
  userId: string | undefined;
  workspaceId: string | undefined;
  server?: boolean;
}) {
  const server = input.server === true;
  const key =
    input.userId && input.workspaceId
      ? historyKey(input.userId, input.workspaceId)
      : null;
  const [state, setState] = useState<{
    key: string | null;
    history: AskHistory;
  }>(() => ({ key, history: key ? readHistory(key) : EMPTY }));
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (stateRef.current.key === key) return;
    setState({ key, history: key ? readHistory(key) : EMPTY });
  }, [key]);

  const change = useCallback(
    (update: (history: AskHistory) => AskHistory) => {
      const current = stateRef.current;
      if (!current.key || current.key !== key) return;
      const history = writeHistory(current.key, update(current.history));
      stateRef.current = { key: current.key, history };
      setState(stateRef.current);
    },
    [key],
  );

  // Server mode.
  const queryClient = useQueryClient();
  const workspaceId = input.workspaceId ?? "";
  const list = useAiConversations(workspaceId, server && key !== null);
  const [serverCurrent, setServerCurrent] = useState<string | null>(null);
  useEffect(() => {
    setServerCurrent(server && key ? readCurrent(key) : null);
  }, [server, key]);
  const listKey = aiKeys.conversations(workspaceId);
  const patchList = useCallback(
    (update: (items: unknown[]) => unknown[]) => {
      queryClient.setQueryData<unknown[]>(listKey, (items) =>
        Array.isArray(items) ? update(items) : items,
      );
    },
    [queryClient, listKey],
  );

  const setCurrent = useCallback(
    (currentId: string | null) => {
      if (server) {
        if (key) writeCurrent(key, currentId);
        setServerCurrent(currentId);
        return;
      }
      change((history) =>
        history.currentId === currentId ? history : { ...history, currentId },
      );
    },
    [server, key, change],
  );

  /** Saves `conversation` (new or updated) as the current one. */
  const save = useCallback(
    (conversation: AskConversation) => {
      if (!server) {
        change((history) => ({
          conversations: [
            conversation,
            ...history.conversations.filter(
              (item) => item.id !== conversation.id,
            ),
          ],
          currentId: conversation.id,
        }));
        return;
      }
      if (!workspaceId) return;
      setCurrent(conversation.id);
      const title = conversationTitle(conversation).slice(0, MAX_TITLE_CHARS);
      patchList((items) => [
        {
          id: conversation.id,
          title,
          projectId: conversation.projectId,
          pinned: conversation.pinned,
          updatedAt: new Date(conversation.updatedAt).toISOString(),
        },
        ...items.filter((item) => record(item)?.id !== conversation.id),
      ]);
      void saveConversation(conversation.id, {
        workspaceId,
        title,
        ...(conversation.projectId
          ? { projectId: conversation.projectId }
          : {}),
        pinned: conversation.pinned,
        turns: conversation.turns,
      })
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: listKey });
        });
    },
    [server, change, workspaceId, setCurrent, patchList, queryClient, listKey],
  );

  const update = useCallback(
    (id: string, patch: { title?: string | null; pinned?: boolean }) => {
      if (!server) {
        change((history) => ({
          ...history,
          conversations: history.conversations.map((item) =>
            item.id === id
              ? {
                  ...item,
                  ...(patch.title !== undefined
                    ? {
                        title:
                          patch.title?.trim().slice(0, MAX_TITLE_CHARS) || null,
                      }
                    : {}),
                  ...(patch.pinned !== undefined
                    ? { pinned: patch.pinned }
                    : {}),
                }
              : item,
          ),
        }));
        return;
      }
      if (!workspaceId) return;
      patchList((items) =>
        items.map((item) =>
          record(item)?.id === id
            ? {
                ...(item as object),
                ...(patch.title ? { title: patch.title } : {}),
                ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
              }
            : item,
        ),
      );
      void updateConversation(workspaceId, id, {
        ...(patch.title ? { title: patch.title.trim() } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      })
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: listKey });
        });
    },
    [server, change, workspaceId, patchList, queryClient, listKey],
  );

  const rename = useCallback(
    (id: string, title: string) => update(id, { title }),
    [update],
  );
  const setPinned = useCallback(
    (id: string, pinned: boolean) => update(id, { pinned }),
    [update],
  );

  const remove = useCallback(
    (id: string) => {
      if (!server) {
        change((history) => ({
          conversations: history.conversations.filter((item) => item.id !== id),
          currentId: history.currentId === id ? null : history.currentId,
        }));
        return;
      }
      if (!workspaceId) return;
      if (serverCurrent === id) setCurrent(null);
      patchList((items) => items.filter((item) => record(item)?.id !== id));
      void deleteConversation(workspaceId, id)
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: listKey });
        });
    },
    [
      server,
      change,
      workspaceId,
      serverCurrent,
      setCurrent,
      patchList,
      queryClient,
      listKey,
    ],
  );

  const serverSummaries = useMemo(
    () =>
      ordered(
        (Array.isArray(list.data) ? list.data : []).flatMap(
          (item) => readServerSummary(item) ?? [],
        ),
      ),
    [list.data],
  );

  const clearAll = useCallback(() => {
    if (!server) {
      change(() => ({ conversations: [], currentId: null }));
      return;
    }
    if (!workspaceId) return;
    const ids = serverSummaries.map((item) => item.id);
    setCurrent(null);
    patchList(() => []);
    void Promise.allSettled(
      ids.map((id) => deleteConversation(workspaceId, id)),
    ).finally(() => {
      void queryClient.invalidateQueries({ queryKey: listKey });
    });
  }, [
    server,
    change,
    workspaceId,
    serverSummaries,
    setCurrent,
    patchList,
    queryClient,
    listKey,
  ]);

  /** A conversation saved in this browser, right away (local mode). */
  const find = useCallback(
    (id: string): AskConversation | null =>
      stateRef.current.history.conversations.find((item) => item.id === id) ??
      null,
    [],
  );

  /** A saved conversation in full, or null when it is gone. */
  const open = useCallback(
    async (id: string): Promise<AskConversation | null> => {
      if (!server) return find(id);
      if (!workspaceId) return null;
      try {
        return readServerConversation(
          await queryClient.fetchQuery({
            queryKey: aiKeys.conversation(workspaceId, id),
            queryFn: () => getConversation(workspaceId, id),
            staleTime: 0,
          }),
        );
      } catch {
        return null;
      }
    },
    [server, workspaceId, queryClient, find],
  );

  /**
   * Copies this browser's conversations to the server, then forgets them
   * here. Returns how many were copied.
   */
  const importLocal = useCallback(async () => {
    const current = stateRef.current;
    if (!server || !workspaceId || !current.key) return 0;
    const local = current.history.conversations;
    const results = await Promise.allSettled(
      local.map((conversation) =>
        saveConversation(conversation.id, {
          workspaceId,
          title: conversationTitle(conversation).slice(0, MAX_TITLE_CHARS),
          ...(conversation.projectId
            ? { projectId: conversation.projectId }
            : {}),
          pinned: conversation.pinned,
          turns: conversation.turns,
        }),
      ),
    );
    const failed = new Set(
      local
        .filter((_item, index) => results[index]?.status === "rejected")
        .map((item) => item.id),
    );
    change((history) => ({
      conversations: history.conversations.filter((item) =>
        failed.has(item.id),
      ),
      currentId: null,
    }));
    void queryClient.invalidateQueries({ queryKey: listKey });
    return local.length - failed.size;
  }, [server, workspaceId, change, queryClient, listKey]);

  const ready = state.key === key;
  const localConversations = ready ? state.history.conversations : [];
  const localSummaries = useMemo(
    () =>
      ordered(
        localConversations.map((item) => ({
          id: item.id,
          projectId: item.projectId,
          updatedAt: item.updatedAt,
          title: conversationTitle(item),
          pinned: item.pinned,
        })),
      ),
    [localConversations],
  );

  const serverReady = !list.isLoading;
  return {
    enabled: key !== null,
    mode: server ? ("server" as const) : ("local" as const),
    loadedKey: !key
      ? null
      : server
        ? serverReady
          ? `server:${key}`
          : null
        : ready
          ? key
          : null,
    conversations: server ? serverSummaries : localSummaries,
    currentId: server ? serverCurrent : ready ? state.history.currentId : null,
    isLoading: server && list.isLoading,
    isError: server && list.isError,
    /** Conversations still only in this browser (server mode offers import). */
    localCount: localConversations.length,
    save,
    setCurrent,
    remove,
    clearAll,
    rename,
    setPinned,
    find,
    open,
    importLocal,
  };
}
