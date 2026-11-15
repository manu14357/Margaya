import { windowId } from "@margaya/libs";
import {
  createBoardDoc,
  parseSettings,
  sanitizeElements,
} from "@margaya/whiteboard";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import {
  CONTROL_MESSAGE_TYPE,
  type ControlMessage,
  isTerminalClose,
  readControlMessage,
  type TerminalKind,
  terminalKind,
} from "@/components/page/collab/collab-protocol";
import type {
  CollabProvider,
  CollabStatus,
} from "@/components/page/collab/use-page-collaboration";
import { getApiUrl } from "@/fetchers/get-api-url";
import { useWhiteboardContent } from "@/hooks/queries/whiteboard/use-whiteboard-content";
import { whiteboardQueryKeys } from "@/hooks/queries/whiteboard/whiteboard-query-keys";
import { toast } from "@/lib/toast";
import {
  type BoardPresence,
  presenceFromBoardStates,
} from "@/lib/whiteboards/board-presence";
import type { CollaboratorIdentity } from "./editor/types";

/** No first sync after this long: the stored copy shows, read-only. */
export const BOARD_FIRST_SYNC_TIMEOUT_MS = 5000;
/** Connection attempts that may fail before the stored-copy fallback. */
export const BOARD_MAX_FAILED_ATTEMPTS = 5;

export function whiteboardSocketUrl(): string {
  return `${getApiUrl("ws").replace(/^http/, "ws")}/whiteboard`;
}

/**
 * The stock y-websocket provider for `/api/ws/whiteboard/{id}?windowId=…`.
 * The board room speaks the page room's wire format and close codes.
 */
export function createWhiteboardProvider(
  doc: Y.Doc,
  whiteboardId: string,
): CollabProvider {
  return new WebsocketProvider(whiteboardSocketUrl(), whiteboardId, doc, {
    connect: false,
    params: { windowId },
    maxBackoffTime: 10_000,
    resyncInterval: 30_000,
    disableBc: false,
    shouldReconnect: (event) => !isTerminalClose(event.code),
  }) as unknown as CollabProvider;
}

type Options = {
  whiteboardId: string;
  /** Who I am on the board; null until the session loads. */
  user: CollaboratorIdentity | null;
  /** Collaborators show only when they are workspace members. */
  getMember: (userId: string) => { name: string; image: string | null } | null;
  /** Tests inject a fake provider. */
  createProvider?: (doc: Y.Doc, whiteboardId: string) => CollabProvider;
};

export type WhiteboardCollaboration = {
  /** The document the editor shows: live, or the stored copy (fallback). */
  doc: Y.Doc | null;
  /** Null while the stored copy shows. */
  awareness: CollabProvider["awareness"] | null;
  status: CollabStatus;
  synced: boolean;
  /** Synced at least once since the board opened. */
  hasSynced: boolean;
  /** The room allows my edits (true until it says otherwise). */
  canWrite: boolean;
  /** A close the provider won't recover from. */
  terminal: { code: number; kind: TerminalKind } | null;
  /** Local edits made while disconnected, not yet synced. */
  pendingOffline: boolean;
  presence: BoardPresence[];
  lastSavedAt: number | null;
  saveError: boolean;
  /** Never synced: the stored copy shows, read-only, while retries go on. */
  fallback: boolean;
  /** The stored copy is loading or failed (only while `fallback`). */
  storedCopy: { isLoading: boolean; isError: boolean };
  failedAttempts: number;
  tooLarge: boolean;
  retry: () => void;
};

type Session = { doc: Y.Doc; provider: CollabProvider };

/**
 * Live collaboration on one board: the Yjs document and its room socket,
 * the room's control messages, presence from awareness, and a read-only
 * stored copy when the room can't be reached.
 */
export function useWhiteboardCollaboration({
  whiteboardId,
  user,
  getMember,
  createProvider = createWhiteboardProvider,
}: Options): WhiteboardCollaboration {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [socketCanWrite, setSocketCanWrite] = useState<boolean | null>(null);
  const [terminal, setTerminal] =
    useState<WhiteboardCollaboration["terminal"]>(null);
  const [pendingOffline, setPendingOffline] = useState(false);
  const [presence, setPresence] = useState<BoardPresence[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [timerKey, setTimerKey] = useState(0);

  const getMemberRef = useRef(getMember);
  getMemberRef.current = getMember;
  const createProviderRef = useRef(createProvider);
  createProviderRef.current = createProvider;
  const tRef = useRef(t);
  tRef.current = t;
  const userRef = useRef(user);
  userRef.current = user;
  const userId = user?.id;

  const handleControl = useCallback(
    (message: ControlMessage) => {
      const translate = tRef.current;
      switch (message.kind) {
        case "state":
          setSocketCanWrite(Boolean(message.canWrite));
          // Lock and archive state show in the header.
          void queryClient.invalidateQueries({
            queryKey: whiteboardQueryKeys.detail(whiteboardId),
            exact: true,
          });
          return;
        case "saved": {
          const at = Date.parse(message.at);
          setLastSavedAt(Number.isNaN(at) ? Date.now() : at);
          setSaveError(false);
          return;
        }
        case "save-error":
          setSaveError(true);
          return;
        case "offline-rejected":
          setPendingOffline(false);
          toast.error(
            message.reason === "locked"
              ? translate("whiteboards:collab.offlineRejected.locked")
              : message.reason === "archived"
                ? translate("whiteboards:collab.offlineRejected.archived")
                : translate("whiteboards:collab.offlineRejected.readOnly"),
          );
          return;
        case "replaced":
          if (message.actorId !== userId) {
            toast.info(
              translate("whiteboards:collab.replacedBy", {
                name:
                  getMemberRef.current(message.actorId)?.name ??
                  translate("whiteboards:list.unknownUser"),
              }),
            );
          }
          return;
        case "too-large":
          setTooLarge(true);
          return;
        case "restored":
          return;
      }
    },
    [queryClient, userId, whiteboardId],
  );
  const handleControlRef = useRef(handleControl);
  handleControlRef.current = handleControl;

  useEffect(() => {
    if (!whiteboardId || !userId) return;
    const doc = new Y.Doc();
    const provider = createProviderRef.current(doc, whiteboardId);
    const awareness = provider.awareness;
    const identity = userRef.current;
    if (identity) {
      awareness.setLocalStateField("user", {
        id: identity.id,
        name: identity.name,
        color: identity.color,
        image: identity.image ?? null,
      });
    }

    provider.messageHandlers[CONTROL_MESSAGE_TYPE] = (_encoder, decoder) => {
      // Malformed or unknown control messages are ignored, never thrown.
      const message = readControlMessage(decoder);
      if (message) handleControlRef.current(message);
    };

    const onStatus = (event: { status: CollabStatus }) =>
      setStatus(event.status);
    const onSync = (state: boolean) => {
      setSynced(state);
      if (!state) return;
      setHasSynced(true);
      setPendingOffline(false);
      setFailedAttempts(0);
      setTimedOut(false);
    };
    const onConnectionClose = () => setFailedAttempts((count) => count + 1);
    let ended = false;
    const onClosed = (event: { code: number }) => {
      ended = true;
      setTerminal({ code: event.code, kind: terminalKind(event.code) });
      if (event.code === 4413 || event.code === 1009) setTooLarge(true);
    };
    const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider && !provider.wsconnected) {
        setPendingOffline(true);
      }
    };
    const onAwareness = () => {
      setPresence(
        presenceFromBoardStates(
          awareness.getStates() as Map<number, Record<string, unknown>>,
          doc.clientID,
          (id) => getMemberRef.current(id),
        ),
      );
    };

    // A socket notices a lost network only after half a minute without
    // messages; the browser knows at once. Going offline right away shows
    // "Offline" and keeps new edits as offline edits until the network is back.
    const onOffline = () => provider.disconnect();
    const onOnline = () => {
      if (!ended) provider.connect();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    provider.on("status", onStatus as never);
    provider.on("sync", onSync as never);
    provider.on("connection-close", onConnectionClose as never);
    provider.on("closed", onClosed as never);
    doc.on("update", onDocUpdate);
    awareness.on("change", onAwareness);
    setSession({ doc, provider });
    provider.connect();

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      provider.off("status", onStatus as never);
      provider.off("sync", onSync as never);
      provider.off("connection-close", onConnectionClose as never);
      provider.off("closed", onClosed as never);
      doc.off("update", onDocUpdate);
      awareness.off("change", onAwareness);
      delete provider.messageHandlers[CONTROL_MESSAGE_TYPE];
      awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
      setSession(null);
      setStatus("connecting");
      setSynced(false);
      setHasSynced(false);
      setSocketCanWrite(null);
      setTerminal(null);
      setPendingOffline(false);
      setPresence([]);
      setLastSavedAt(null);
      setSaveError(false);
      setFailedAttempts(0);
      setTimedOut(false);
      setTooLarge(false);
    };
  }, [whiteboardId, userId]);

  // A changed name or picture reaches the others without a reconnect.
  const userName = user?.name;
  const userImage = user?.image;
  const userColor = user?.color;
  useEffect(() => {
    if (!session || !userId) return;
    session.provider.awareness.setLocalStateField("user", {
      id: userId,
      name: userName ?? "",
      color: userColor ?? "",
      image: userImage ?? null,
    });
  }, [session, userId, userName, userImage, userColor]);

  // No first sync in time: the stored copy shows while retries go on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: timerKey restarts the wait on retry
  useEffect(() => {
    if (!session || hasSynced) return;
    const timer = setTimeout(
      () => setTimedOut(true),
      BOARD_FIRST_SYNC_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [session, hasSynced, timerKey]);

  // Unsynced offline edits: the browser asks before the tab closes.
  useEffect(() => {
    if (!pendingOffline) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingOffline]);

  const fallback =
    Boolean(session) &&
    !hasSynced &&
    (timedOut || failedAttempts >= BOARD_MAX_FAILED_ATTEMPTS);
  const stored = useWhiteboardContent(whiteboardId, fallback);
  const storedDoc = useMemo(
    () =>
      stored.data
        ? createBoardDoc(
            sanitizeElements(stored.data.elements),
            parseSettings(stored.data.settings),
          )
        : null,
    [stored.data],
  );
  useEffect(() => () => storedDoc?.destroy(), [storedDoc]);

  const retry = useCallback(() => {
    if (!session) return;
    void queryClient.invalidateQueries({
      queryKey: whiteboardQueryKeys.detail(whiteboardId),
      exact: true,
    });
    setTerminal(null);
    setTimedOut(false);
    setFailedAttempts(0);
    setTimerKey((key) => key + 1);
    session.provider.connect();
  }, [queryClient, session, whiteboardId]);

  return {
    doc: fallback ? storedDoc : (session?.doc ?? null),
    awareness: fallback ? null : (session?.provider.awareness ?? null),
    status,
    synced,
    hasSynced,
    canWrite: socketCanWrite ?? true,
    terminal,
    pendingOffline,
    presence,
    lastSavedAt,
    saveError,
    fallback,
    storedCopy: {
      isLoading: fallback && stored.isLoading,
      isError: fallback && stored.isError,
    },
    failedAttempts,
    tooLarge,
    retry,
  };
}
