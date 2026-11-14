import * as Sentry from "@sentry/node";
import { HTTPException } from "hono/http-exception";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import type { RevalidateResult as PageRevalidateResult } from "../../page/collab/access";
import { PageConnection } from "../../page/collab/connection";
import { COLLAB_CLOSE, COLLAB_LIMITS } from "../../page/collab/limits";
import {
  type PersistResult,
  PersistScheduler,
} from "../../page/collab/persist-scheduler";
import {
  type ControlMessage,
  decodeClientMessage,
  encodeAwarenessMessage,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
  updateHasNewContent,
} from "../../page/collab/protocol";
import { featureDisabledMessage } from "../../project/features";
import type { DocBroadcast } from "../../ws/broadcast-adapter";
import { BOARD_DOC, BOARD_LIMITS, elementsMap, settingsMap } from "../board";
import { type BoardContent, docContent } from "../content";
import {
  BOARD_DOC_ORIGIN,
  type BoardPersistInput,
  type BoardPersistOutcome,
  WhiteboardTooLargeError,
} from "../persistence";
import {
  editableStateError,
  WHITEBOARD_MESSAGES,
  type WhiteboardCaller,
} from "../rules";
import {
  type BoardIdentity,
  checkBoardAwareness,
  decodeBoardAwareness,
  encodeBoardAwareness,
  withAccountIdentity,
} from "./awareness-guard";
import {
  type BoardLoadResult,
  type BoardMeta,
  type BoardMetaResult,
  boardMetaChanged,
  boardMetaOf,
  boardOfflineRejectedReason,
  boardStateMessage,
  canWriteBoard,
} from "./meta";
import {
  boardUpdateShapeError,
  elementRepairs,
  hasRepairs,
  settingsRepairs,
} from "./validate";

// One board's live document on this instance: the Yjs doc, the server's
// awareness, the local connections and persistence. It speaks the page
// room's wire format and reuses its connection, limits and persist
// scheduler; what differs is the content (board elements, validated after
// every client change) and the access rules.

export type BoardConnectionIdentity = PageConnection["identity"] &
  BoardIdentity;

/** A board socket: the page connection with a board caller and identity. */
export class BoardConnection extends PageConnection<WhiteboardCaller> {
  declare readonly identity: BoardConnectionIdentity;
}

export type BoardRevalidateResult =
  | { status: "ok"; caller: WhiteboardCaller }
  | Extract<PageRevalidateResult, { status: "close" }>;

export type BoardDocChannel = {
  publish(message: Omit<DocBroadcast, "origin">): void;
  subscribe(
    key: string,
    handler: (message: DocBroadcast) => void,
  ): Promise<void>;
  unsubscribe(key: string): Promise<void>;
};

export type BoardRoomDeps = {
  load(whiteboardId: string): Promise<BoardLoadResult>;
  readMeta(whiteboardId: string): Promise<BoardMetaResult>;
  persist(input: BoardPersistInput): Promise<BoardPersistOutcome>;
  revalidate(
    identity: BoardConnectionIdentity,
    meta: BoardMeta,
  ): Promise<BoardRevalidateResult>;
  channel: BoardDocChannel;
  onDocBroadcast(room: WhiteboardRoom, message: DocBroadcast): void;
  onClosed(room: WhiteboardRoom): void;
};

/** The document channel key of a board: never the same as a page id. */
export function boardChannelKey(whiteboardId: string): string {
  return `whiteboard:${whiteboardId}`;
}

/** The origin of changes that came from another instance. */
export class RemoteBoardOrigin {
  constructor(readonly userId: string | null) {}
}

const CLOSE_ORIGIN = "close";
const REMOTE_AWARENESS_ORIGIN = "remote";
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

type ServerChangeRun = {
  actorId: string;
  mutate(doc: Y.Doc): void;
};

type PersistAttempt =
  | { result: "saved"; contentVersion: number }
  | { result: "failed"; error: unknown }
  | { result: "idle" }
  | { result: "closed"; reason: "gone" | "feature-off" | "too-large" };

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function unrefTimer<T extends ReturnType<typeof setTimeout>>(timer: T): T {
  timer.unref?.();
  return timer;
}

export class WhiteboardRoom {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly connections = new Set<BoardConnection>();
  readonly ready: Promise<boolean>;
  meta: BoardMeta | null = null;

  private status: "loading" | "ready" | "closed" = "loading";
  private knownContentVersion: number | null = null;
  private dirty = false;
  private generation = 0;
  private lastContributor: string | null = null;
  /** Everyone whose edits the next save holds (the board history). */
  private contributors = new Set<string>();
  private persistTail: Promise<unknown> = Promise.resolve();
  private readonly scheduler: PersistScheduler;
  private readonly queuedBytes = new WeakMap<BoardConnection, number>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private revalidateTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * A client update that needs a server repair: held until the repair
   * transaction (which runs right after it) so others get both as one update.
   */
  private held: { update: Uint8Array; from: BoardConnection } | null = null;
  private repairing = false;

  constructor(
    readonly whiteboardId: string,
    private readonly deps: BoardRoomDeps,
  ) {
    this.awareness.setLocalState(null);
    // Root types are created before any update, so a client can't define
    // them as another kind.
    elementsMap(this.doc);
    settingsMap(this.doc);
    this.doc.on("update", (update: Uint8Array, origin: unknown) =>
      this.onDocUpdate(update, origin),
    );
    this.doc
      .getMap(BOARD_DOC.elements)
      .observe((event, transaction) =>
        this.validateElements(event, transaction),
      );
    this.doc
      .getMap(BOARD_DOC.settings)
      .observe((_event, transaction) => this.validateSettings(transaction));
    this.awareness.on(
      "update",
      (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => this.onAwarenessUpdate(changes, origin),
    );
    this.scheduler = new PersistScheduler({
      persist: () => this.persistDirty(),
      onSaveError: () => this.broadcastControl({ kind: "save-error" }),
    });
    this.ready = this.load();
  }

  get isClosed() {
    return this.status === "closed";
  }

  get isDirty() {
    return this.dirty;
  }

  get channelKey() {
    return boardChannelKey(this.whiteboardId);
  }

  // -------------------------------------------------------------------
  // Lifecycle

  private async load(): Promise<boolean> {
    let loaded: BoardLoadResult;
    try {
      loaded = await this.deps.load(this.whiteboardId);
    } catch (error) {
      console.error(`Board room ${this.whiteboardId} failed to load:`, error);
      Sentry.captureException(error);
      this.close(COLLAB_CLOSE.internalError, "Couldn't load the whiteboard");
      return false;
    }
    if (this.status === "closed") return false;
    if (loaded.status !== "ok") {
      this.close(COLLAB_CLOSE.gone, WHITEBOARD_MESSAGES.notFound);
      return false;
    }
    if (loaded.state) {
      Y.applyUpdate(this.doc, loaded.state, BOARD_DOC_ORIGIN.db);
    }
    this.meta = loaded.meta;
    this.knownContentVersion = loaded.meta.contentVersion;
    try {
      await this.deps.channel.subscribe(this.channelKey, (message) =>
        this.deps.onDocBroadcast(this, message),
      );
    } catch (error) {
      console.error(
        `Board room ${this.whiteboardId} channel subscribe failed:`,
        error,
      );
    }
    if (this.isClosed) return false;
    this.publish({
      kind: "sync-request",
      data: toBase64(Y.encodeStateVector(this.doc)),
    });
    this.publish({ kind: "awareness-query" });

    this.status = "ready";
    this.revalidateTimer = unrefTimer(
      setInterval(() => void this.revalidateAll(), COLLAB_LIMITS.revalidateMs),
    );
    this.heartbeatTimer = unrefTimer(
      setInterval(() => this.heartbeat(), COLLAB_LIMITS.heartbeatMs),
    );
    for (const connection of this.connections) this.greet(connection);
    if (this.connections.size === 0) this.armIdle();
    return true;
  }

  /** Closes every local connection and unloads without persisting. */
  close(code: number, reason: string) {
    if (this.status === "closed") return;
    this.status = "closed";
    this.scheduler.stop();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const connection of this.connections) connection.close(code, reason);
    this.connections.clear();
    void this.deps.channel.unsubscribe(this.channelKey).catch((error) => {
      console.error(
        `Board room ${this.whiteboardId} unsubscribe failed:`,
        error,
      );
    });
    this.doc.destroy();
    this.deps.onClosed(this);
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = unrefTimer(
      setTimeout(() => {
        this.idleTimer = null;
        if (this.status !== "ready" || this.connections.size > 0) return;
        if (this.dirty) {
          this.armIdle();
          return;
        }
        this.close(1001, "Idle");
      }, COLLAB_LIMITS.idleUnloadMs),
    );
  }

  /** Persists now if dirty (and waits for a running persist). */
  async flush(): Promise<void> {
    if (!(await this.ready) || this.status !== "ready") return;
    await this.scheduler.now();
  }

  // -------------------------------------------------------------------
  // Connections

  addConnection(connection: BoardConnection): boolean {
    if (this.status === "closed") {
      connection.close(COLLAB_CLOSE.restarting, "Reconnect");
      return false;
    }
    if (this.connections.size >= COLLAB_LIMITS.connectionsPerRoom) {
      connection.close(
        COLLAB_CLOSE.roomFull,
        "Too many people have this whiteboard open",
      );
      return false;
    }
    this.connections.add(connection);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.status === "ready") this.greet(connection);
    return true;
  }

  removeConnection(connection: BoardConnection) {
    if (!this.connections.delete(connection)) return;
    const controlled = [...connection.controlled];
    connection.controlled.clear();
    if (controlled.length > 0 && this.status !== "closed") {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        controlled,
        CLOSE_ORIGIN,
      );
    }
    if (this.connections.size === 0 && this.status === "ready") {
      void this.scheduler.now();
      this.armIdle();
    }
  }

  private greet(connection: BoardConnection) {
    const meta = this.meta;
    if (connection.closed || connection.greeted || !meta) return;
    if (!connection.caller.canRead) {
      connection.close(COLLAB_CLOSE.forbidden, WHITEBOARD_MESSAGES.notFound);
      return;
    }
    connection.canWrite = canWriteBoard(meta, connection.caller);
    connection.greeted = true;
    connection.send(encodeSyncStep1(this.doc));
    const clients = [...this.awareness.getStates().keys()];
    if (clients.length > 0) connection.send(this.awarenessFrame(clients));
    connection.sendControl(boardStateMessage(meta, connection.canWrite));
    for (const frame of connection.queue.splice(0)) {
      this.process(connection, frame);
    }
    this.queuedBytes.delete(connection);
  }

  receive(connection: BoardConnection, frame: Uint8Array) {
    if (connection.closed || this.status === "closed") return;
    if (!connection.admit()) {
      connection.close(COLLAB_CLOSE.rateLimited, "Slow down");
      return;
    }
    if (!connection.greeted) {
      const queued = (this.queuedBytes.get(connection) ?? 0) + frame.byteLength;
      if (queued > MAX_QUEUED_BYTES) {
        connection.close(COLLAB_CLOSE.rateLimited, "Slow down");
        return;
      }
      this.queuedBytes.set(connection, queued);
      connection.queue.push(frame);
      return;
    }
    this.process(connection, frame);
  }

  private process(connection: BoardConnection, frame: Uint8Array) {
    if (connection.closed || this.status !== "ready") return;
    try {
      const message = decodeClientMessage(frame);
      switch (message.type) {
        case "sync-step1":
          connection.send(encodeSyncStep2(this.doc, message.stateVector));
          return;
        case "sync-step2":
        case "sync-update":
          this.receiveUpdate(connection, message.update);
          return;
        case "awareness":
          this.receiveAwareness(connection, message.update);
          return;
        case "query-awareness":
          connection.send(this.awarenessFrame());
          return;
        case "auth":
          return;
        default:
          connection.close(COLLAB_CLOSE.unsupported, "Unsupported message");
      }
    } catch (error) {
      Sentry.captureException(error);
      connection.close(COLLAB_CLOSE.unsupported, "Unsupported message");
    }
  }

  private receiveUpdate(connection: BoardConnection, update: Uint8Array) {
    if (!connection.canWrite) {
      // A read-only socket's edits are never applied; its offline edits get
      // a notice at most once a minute.
      const meta = this.meta;
      if (
        meta &&
        updateHasNewContent(this.doc, update) &&
        connection.mayNotifyOfflineRejected()
      ) {
        connection.sendControl({
          kind: "offline-rejected",
          reason: boardOfflineRejectedReason(meta),
        });
      }
      return;
    }
    const shapeError = boardUpdateShapeError(update);
    if (shapeError) {
      connection.close(COLLAB_CLOSE.unsupported, "Invalid board content");
      return;
    }
    Y.applyUpdate(this.doc, update, connection);
    // A repair that changed nothing emits no update: forward the held one.
    const held = this.held;
    this.held = null;
    this.repairing = false;
    if (held) this.forwardClientUpdate(held.update, held.from);
  }

  private forwardClientUpdate(update: Uint8Array, from: BoardConnection) {
    this.sendToAll(encodeSyncUpdate(update), from);
    this.publish({
      kind: "update",
      userId: from.userId,
      data: toBase64(update),
    });
    this.markDirty(from.userId);
  }

  private controllerOf(clientId: number): BoardConnection | undefined {
    for (const connection of this.connections) {
      if (connection.controlled.has(clientId)) return connection;
    }
    return undefined;
  }

  private receiveAwareness(connection: BoardConnection, update: Uint8Array) {
    const entries = decodeBoardAwareness(update);
    const verdict = checkBoardAwareness(entries, {
      userId: connection.userId,
      controlled: connection.controlled,
      known: (clientId) => {
        const meta = this.awareness.meta.get(clientId);
        return meta
          ? { clock: meta.clock, hasState: this.awareness.states.has(clientId) }
          : undefined;
      },
      controlledByOther: (clientId) => {
        const other = this.controllerOf(clientId);
        return other && other !== connection ? other.userId : undefined;
      },
    });
    if (verdict.kind === "too-many-clients") {
      connection.close(COLLAB_CLOSE.unsupported, "Too many awareness clients");
      return;
    }
    if (verdict.kind !== "apply") return;
    for (const clientId of verdict.claimed) {
      this.controllerOf(clientId)?.controlled.delete(clientId);
      connection.controlled.add(clientId);
    }
    awarenessProtocol.applyAwarenessUpdate(
      this.awareness,
      encodeBoardAwareness(withAccountIdentity(entries, connection.identity)),
      connection,
    );
  }

  private awarenessFrame(clients = [...this.awareness.getStates().keys()]) {
    return encodeAwarenessMessage(
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
    );
  }

  private heartbeat() {
    for (const connection of [...this.connections]) {
      if (connection.heartbeat()) continue;
      connection.close(1001, "No response");
      this.removeConnection(connection);
    }
  }

  // -------------------------------------------------------------------
  // Validation of client changes

  private validateElements(
    event: Y.YMapEvent<unknown>,
    transaction: Y.Transaction,
  ) {
    if (!(transaction.origin instanceof BoardConnection)) return;
    const added = new Set<string>();
    for (const [key, change] of event.changes.keys) {
      if (change.action === "add") added.add(key);
    }
    const map = this.doc.getMap<unknown>(BOARD_DOC.elements);
    const repair = elementRepairs(map, event.keysChanged, added);
    if (!hasRepairs(repair, null)) return;
    this.repair(() => {
      for (const key of repair.remove) map.delete(key);
      for (const element of repair.replace) map.set(element.id, element);
    });
  }

  private validateSettings(transaction: Y.Transaction) {
    if (!(transaction.origin instanceof BoardConnection)) return;
    const map = this.doc.getMap<unknown>(BOARD_DOC.settings);
    const repair = settingsRepairs(map);
    if (!hasRepairs({ remove: [], replace: [] }, repair)) return;
    this.repair(() => {
      for (const key of repair.remove) map.delete(key);
      for (const [key, value] of Object.entries(repair.set))
        map.set(key, value);
    });
  }

  /**
   * Runs `fix` in a server transaction. Yjs runs it right after the client
   * transaction that triggered it, so the client's update is held back and
   * forwarded together with the fix.
   */
  private repair(fix: () => void) {
    this.repairing = true;
    this.doc.transact(fix, BOARD_DOC_ORIGIN.repair);
  }

  // -------------------------------------------------------------------
  // Fan-out

  private sendToAll(frame: Uint8Array, except?: BoardConnection) {
    for (const connection of this.connections) {
      if (connection === except || !connection.greeted) continue;
      connection.send(frame);
    }
  }

  broadcastControl(message: ControlMessage) {
    for (const connection of this.connections) {
      if (connection.greeted) connection.sendControl(message);
    }
  }

  private publish(message: Omit<DocBroadcast, "origin" | "pageId">) {
    this.deps.channel.publish({ ...message, pageId: this.channelKey });
  }

  private onDocUpdate(update: Uint8Array, origin: unknown) {
    if (this.status === "closed") return;
    if (origin instanceof BoardConnection) {
      if (this.repairing) {
        this.held = { update, from: origin };
        return;
      }
      this.forwardClientUpdate(update, origin);
      return;
    }
    if (origin === BOARD_DOC_ORIGIN.repair) {
      this.repairing = false;
      const held = this.held;
      this.held = null;
      if (!held) {
        this.sendToAll(encodeSyncUpdate(update));
        this.markDirty(null);
        return;
      }
      // The sender holds the invalid state: it gets the fix alone; everyone
      // else gets the change and its fix as one update.
      held.from.send(encodeSyncUpdate(update));
      const merged = Y.mergeUpdates([held.update, update]);
      this.sendToAll(encodeSyncUpdate(merged), held.from);
      this.publish({
        kind: "update",
        userId: held.from.userId,
        data: toBase64(merged),
      });
      this.markDirty(held.from.userId);
      return;
    }
    if (origin instanceof RemoteBoardOrigin) {
      this.sendToAll(encodeSyncUpdate(update));
      this.markDirty(origin.userId);
      return;
    }
    if (origin === BOARD_DOC_ORIGIN.server) {
      // Saved by the server change that made it.
      this.sendToAll(encodeSyncUpdate(update));
      this.publish({ kind: "update", data: toBase64(update) });
      return;
    }
    // The database (load, the persist pull).
    this.sendToAll(encodeSyncUpdate(update));
  }

  private onAwarenessUpdate(
    {
      added,
      updated,
      removed,
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) {
    if (this.status === "closed") return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    const update = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      changed,
    );
    this.sendToAll(encodeAwarenessMessage(update));
    if (origin !== REMOTE_AWARENESS_ORIGIN && origin !== "timeout") {
      this.publish({ kind: "awareness", data: toBase64(update) });
    }
  }

  applyRemoteUpdate(update: Uint8Array, userId: string | null) {
    if (this.status === "closed") return;
    Y.applyUpdate(this.doc, update, new RemoteBoardOrigin(userId));
  }

  applyRemoteAwareness(update: Uint8Array) {
    if (this.status === "closed") return;
    awarenessProtocol.applyAwarenessUpdate(
      this.awareness,
      update,
      REMOTE_AWARENESS_ORIGIN,
    );
  }

  localAwarenessUpdate(): Uint8Array | null {
    const clients = [...this.connections].flatMap((connection) => [
      ...connection.controlled,
    ]);
    const present = clients.filter((id) => this.awareness.states.has(id));
    return present.length > 0
      ? awarenessProtocol.encodeAwarenessUpdate(this.awareness, present)
      : null;
  }

  diffAgainst(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, stateVector);
  }

  // -------------------------------------------------------------------
  // Persistence

  private markDirty(userId: string | null) {
    this.generation++;
    this.dirty = true;
    if (userId) {
      this.lastContributor = userId;
      this.contributors.add(userId);
    }
    this.scheduler.changed();
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.persistTail.then(task, task);
    this.persistTail = run.catch(() => {});
    return run;
  }

  private async persistDirty(): Promise<PersistResult> {
    const attempt = await this.serialize(() => this.persistOnce());
    if (attempt.result === "failed") {
      console.error(
        `Board room ${this.whiteboardId} persist failed:`,
        attempt.error,
      );
      Sentry.captureException(attempt.error);
      return "failed";
    }
    return attempt.result === "saved" ? "saved" : "idle";
  }

  private async persistOnce(change?: ServerChangeRun): Promise<PersistAttempt> {
    if (this.status !== "ready") return { result: "idle" };
    if (!change && !this.dirty) return { result: "idle" };
    const generation = this.generation;
    const actorId = change?.actorId ?? this.lastContributor;
    const contributorIds = [
      ...new Set([...this.contributors, ...(change ? [change.actorId] : [])]),
    ];
    let outcome: BoardPersistOutcome;
    try {
      outcome = await this.deps.persist({
        whiteboardId: this.whiteboardId,
        doc: this.doc,
        knownContentVersion: this.knownContentVersion,
        actorId,
        contributorIds,
        guard: change
          ? (row) => {
              const error = editableStateError(row);
              if (error) throw new HTTPException(409, { message: error });
            }
          : undefined,
        mutate: change ? (doc) => change.mutate(doc) : undefined,
      });
    } catch (error) {
      if (error instanceof WhiteboardTooLargeError) {
        this.broadcastControl({
          kind: "too-large",
          limitBytes: BOARD_LIMITS.maxDocumentBytes,
        });
        this.close(COLLAB_CLOSE.tooLarge, WHITEBOARD_MESSAGES.tooLarge);
        return { result: "closed", reason: "too-large" };
      }
      if (change && error instanceof HTTPException) throw error;
      return { result: "failed", error };
    }
    if (outcome.status !== "saved") {
      this.close(COLLAB_CLOSE.gone, WHITEBOARD_MESSAGES.notFound);
      return { result: "closed", reason: outcome.status };
    }
    this.knownContentVersion = outcome.contentVersion;
    if (this.generation === generation) {
      this.dirty = false;
      // Later edits keep their authors for the next save.
      this.contributors.clear();
    }
    // The row was read under the lock: a lost meta message heals here.
    this.applyMeta(boardMetaOf(outcome.board));
    if (outcome.changed) {
      this.broadcastControl({
        kind: "saved",
        at: new Date().toISOString(),
        contentVersion: outcome.contentVersion,
      });
    }
    return { result: "saved", contentVersion: outcome.contentVersion };
  }

  /**
   * Applies a REST change through the live doc under the persist's row lock
   * and saves it at once. Null when the room is gone.
   */
  async applyServerChange(
    change: ServerChangeRun,
  ): Promise<{ contentVersion: number } | null> {
    if (!(await this.ready) || this.status !== "ready") return null;
    return this.serialize(async () => {
      if (this.dirty) await this.persistOnce();
      const attempt = await this.persistOnce(change);
      switch (attempt.result) {
        case "idle":
          return null;
        case "failed":
          throw attempt.error;
        case "closed":
          if (attempt.reason === "too-large") {
            throw new HTTPException(413, {
              message: WHITEBOARD_MESSAGES.tooLarge,
            });
          }
          if (attempt.reason === "feature-off") {
            throw new HTTPException(403, {
              message: featureDisabledMessage("whiteboards"),
            });
          }
          throw new HTTPException(404, {
            message: WHITEBOARD_MESSAGES.notFound,
          });
      }
      return { contentVersion: attempt.contentVersion };
    });
  }

  /** The live content (unsaved edits included); null when the room is gone. */
  async liveContent(): Promise<BoardContent | null> {
    if (!(await this.ready) || this.status !== "ready") return null;
    return docContent(this.doc, this.knownContentVersion ?? 0);
  }

  // -------------------------------------------------------------------
  // Meta and revalidation

  applyMeta(meta: BoardMeta) {
    const changed = boardMetaChanged(this.meta, meta);
    this.meta = meta;
    for (const connection of this.connections) {
      this.syncConnectionState(connection, changed);
    }
  }

  private syncConnectionState(connection: BoardConnection, force: boolean) {
    const meta = this.meta;
    if (!meta || connection.closed || !connection.greeted) return;
    if (!connection.caller.canRead) {
      connection.close(COLLAB_CLOSE.forbidden, WHITEBOARD_MESSAGES.notFound);
      return;
    }
    const canWrite = canWriteBoard(meta, connection.caller);
    if (!force && canWrite === connection.canWrite) return;
    connection.canWrite = canWrite;
    connection.sendControl(boardStateMessage(meta, canWrite));
  }

  /** Re-reads the board (after a board event), then every connection. */
  async refresh() {
    if (!(await this.ready) || this.status !== "ready") return;
    const result = await this.deps.readMeta(this.whiteboardId);
    if (this.status !== "ready") return;
    if (result.status !== "ok") {
      this.close(COLLAB_CLOSE.gone, WHITEBOARD_MESSAGES.notFound);
      return;
    }
    this.applyMeta(result.meta);
    await this.revalidateAll();
  }

  async revalidateAll() {
    const meta = this.meta;
    if (!meta || this.status !== "ready") return;
    await Promise.all(
      [...this.connections].map(async (connection) => {
        if (connection.closed) return;
        const generation = ++connection.revalidationsStarted;
        try {
          const result = await this.deps.revalidate(connection.identity, meta);
          if (connection.closed) return;
          if (generation < connection.revalidationApplied) return;
          connection.revalidationApplied = generation;
          if (result.status === "close") {
            connection.close(result.code, result.reason);
            return;
          }
          connection.caller = result.caller;
          this.syncConnectionState(connection, false);
        } catch (error) {
          console.error(
            `Board room ${this.whiteboardId} revalidation failed:`,
            error,
          );
        }
      }),
    );
  }
}
