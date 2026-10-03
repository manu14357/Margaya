import { windowId } from "@margaya/libs";
import { useQueryClient } from "@tanstack/react-query";
import type * as decoding from "lib0/decoding";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { pageQueryKeys } from "@/hooks/queries/page/page-query-keys";
import { collabColorKey } from "@/lib/pages/collab-colors";
import { toast } from "@/lib/toast";
import {
  CONTROL_MESSAGE_TYPE,
  type ControlMessage,
  isTerminalClose,
  type PresenceEntry,
  presenceFromStates,
  readControlMessage,
  type TerminalKind,
  terminalKind,
} from "./collab-protocol";

export type CollabStatus = "connecting" | "connected" | "disconnected";

/** No first sync after this long: show the stored copy (§4.5). */
export const FIRST_SYNC_TIMEOUT_MS = 5000;
/** Connection attempts that may fail before the stored-copy fallback. */
export const MAX_FAILED_ATTEMPTS = 5;

type MessageHandler = (
  encoder: unknown,
  decoder: decoding.Decoder,
  provider: unknown,
  emitSynced: boolean,
  messageType: number,
) => void;

/** The parts of y-websocket's provider this hook uses (mockable). */
export type CollabProvider = {
  awareness: WebsocketProvider["awareness"];
  messageHandlers: MessageHandler[];
  wsconnected: boolean;
  synced: boolean;
  connect: () => void;
  disconnect: () => void;
  destroy: () => void;
  on: (event: string, handler: (...args: never[]) => void) => void;
  off: (event: string, handler: (...args: never[]) => void) => void;
};

export function pageSocketUrl(): string {
  return `${getApiUrl("ws").replace(/^http/, "ws")}/page`;
}

/** The stock y-websocket provider for `/api/ws/page/{pageId}?windowId=…`. */
export function createPageProvider(doc: Y.Doc, pageId: string): CollabProvider {
  return new WebsocketProvider(pageSocketUrl(), pageId, doc, {
    connect: false,
    params: { windowId },
    maxBackoffTime: 10_000,
    resyncInterval: 30_000,
    disableBc: false,
    shouldReconnect: (event) => !isTerminalClose(event.code),
  }) as unknown as CollabProvider;
}

type Options = {
  pageId: string;
  userId: string | undefined;
  /** A collaborator's display name; null for people who aren't members. */
  resolveName: (userId: string) => string | null;
  /** Tests inject a fake provider. */
  createProvider?: (doc: Y.Doc, pageId: string) => CollabProvider;
};

export type PageCollaboration = {
  doc: Y.Doc | null;
  provider: CollabProvider | null;
  status: CollabStatus;
  /** Synced with the server right now. */
  synced: boolean;
  /** Synced at least once since the page opened. */
  hasSynced: boolean;
  /** The socket allows edits (true until it says otherwise). */
  canWrite: boolean;
  /** A close the provider won't recover from. */
  terminal: { code: number; kind: TerminalKind } | null;
  /** Local edits made while disconnected, not yet synced. */
  pendingOffline: boolean;
  presence: PresenceEntry[];
  /** When the server last saved the document (ms). */
  lastSavedAt: number | null;
  /** The server failed to save twice in a row; it keeps retrying. */
  saveError: boolean;
  /** Never synced: show the stored copy instead of the live editor. */
  fallback: boolean;
  /** Consecutive failed connection attempts. */
  failedAttempts: number;
  /** The server refused the document as too large. */
  tooLarge: boolean;
  retry: () => void;
};

type Session = { doc: Y.Doc; provider: CollabProvider };

/**
 * Live editing of a page over the page socket (§4.5): the Yjs document and
 * provider, the server's control messages, presence, and what the UI shows
 * about the connection.
 */
export function usePageCollaboration({
  pageId,
  userId,
  resolveName,
  createProvider = createPageProvider,
}: Options): PageCollaboration {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<CollabStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [socketCanWrite, setSocketCanWrite] = useState<boolean | null>(null);
  const [terminal, setTerminal] = useState<PageCollaboration["terminal"]>(null);
  const [pendingOffline, setPendingOffline] = useState(false);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [timerKey, setTimerKey] = useState(0);

  const resolveNameRef = useRef(resolveName);
  resolveNameRef.current = resolveName;
  const createProviderRef = useRef(createProvider);
  createProviderRef.current = createProvider;
  const tRef = useRef(t);
  tRef.current = t;

  const handleControl = useCallback(
    (message: ControlMessage) => {
      const translate = tRef.current;
      const actorName = (actorId: string) =>
        resolveNameRef.current(actorId) ??
        translate("pages:history.unknownUser");
      switch (message.kind) {
        case "state":
          setSocketCanWrite(Boolean(message.canWrite));
          queryClient.invalidateQueries({
            queryKey: pageQueryKeys.detail(pageId),
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
            translate(`pages:collab.offlineRejected.${message.reason}`, {
              defaultValue: translate("pages:collab.offlineRejected.readOnly"),
            }),
          );
          return;
        case "restored":
          queryClient.invalidateQueries({
            queryKey: pageQueryKeys.versions(pageId),
          });
          if (message.actorId !== userId) {
            toast.info(
              translate("pages:collab.restoredBy", {
                name: actorName(message.actorId),
              }),
            );
          }
          return;
        case "replaced":
          if (message.actorId !== userId) {
            toast.info(
              translate("pages:collab.replacedBy", {
                name: actorName(message.actorId),
              }),
            );
          }
          return;
        case "too-large":
          setTooLarge(true);
          return;
      }
    },
    [pageId, queryClient, userId],
  );
  const handleControlRef = useRef(handleControl);
  handleControlRef.current = handleControl;

  useEffect(() => {
    if (!pageId || !userId) return;
    const doc = new Y.Doc();
    const provider = createProviderRef.current(doc, pageId);
    const awareness = provider.awareness;
    // Palette key only: the server refuses any other user field.
    awareness.setLocalStateField("user", {
      id: userId,
      color: collabColorKey(userId),
    });

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
    const onClosed = (event: { code: number }) => {
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
        presenceFromStates(
          awareness.getStates() as Map<number, Record<string, unknown>>,
          doc.clientID,
          (id) => resolveNameRef.current(id) !== null,
        ),
      );
    };

    provider.on("status", onStatus as never);
    provider.on("sync", onSync as never);
    provider.on("connection-close", onConnectionClose as never);
    provider.on("closed", onClosed as never);
    doc.on("update", onDocUpdate);
    awareness.on("change", onAwareness);
    setSession({ doc, provider });
    provider.connect();

    return () => {
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
  }, [pageId, userId]);

  // No first sync in time: the stored copy shows while retries go on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: timerKey restarts the wait on retry
  useEffect(() => {
    if (!session || hasSynced) return;
    const timer = setTimeout(() => setTimedOut(true), FIRST_SYNC_TIMEOUT_MS);
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

  const retry = useCallback(() => {
    if (!session) return;
    void queryClient.invalidateQueries({
      queryKey: pageQueryKeys.detail(pageId),
      exact: true,
    });
    setTerminal(null);
    setTimedOut(false);
    setFailedAttempts(0);
    setTimerKey((key) => key + 1);
    session.provider.connect();
  }, [pageId, queryClient, session]);

  return {
    doc: session?.doc ?? null,
    provider: session?.provider ?? null,
    status,
    synced,
    hasSynced,
    canWrite: socketCanWrite ?? true,
    terminal,
    pendingOffline,
    presence,
    lastSavedAt,
    saveError,
    fallback: !hasSynced && (timedOut || failedAttempts >= MAX_FAILED_ATTEMPTS),
    failedAttempts,
    tooLarge,
    retry,
  };
}
