import {
  applyJsonToYDoc,
  type PageDocument,
  yDocToJson,
} from "@margaya/editor-schema";
import * as Sentry from "@sentry/node";
import { HTTPException } from "hono/http-exception";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { featureDisabledMessage } from "../../project/features";
import type { DocBroadcast } from "../../ws/broadcast-adapter";
import type { ServerChange, ServerChangeResult } from "../content";
import {
  PAGE_DOC_ORIGIN,
  PageTooLargeError,
  type PersistInput,
  type PersistOutcome,
} from "../persistence";
import { canSeePage, editableStateError, PAGE_MESSAGES } from "../rules";
import type { RevalidateResult } from "./access";
import { checkAwarenessUpdate, decodeAwarenessUpdate } from "./awareness-guard";
import { type ConnectionIdentity, PageConnection } from "./connection";
import { COLLAB_CLOSE, COLLAB_LIMITS } from "./limits";
import {
  canWriteFor,
  type LoadResult,
  type MetaResult,
  metaOf,
  metaStateChanged,
  offlineRejectedReason,
  type PageMeta,
  stateMessage,
} from "./meta";
import { type PersistResult, PersistScheduler } from "./persist-scheduler";
import {
  type ControlMessage,
  decodeClientMessage,
  encodeAwarenessMessage,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
  updateHasNewContent,
} from "./protocol";

// One page's live document on this instance (spec §5.4–5.6): the Yjs doc,
// the server's awareness, the local connections, and persistence.

export type DocChannel = {
  publish(message: Omit<DocBroadcast, "origin">): void;
  subscribe(
    pageId: string,
    handler: (message: DocBroadcast) => void,
  ): Promise<void>;
  unsubscribe(pageId: string): Promise<void>;
};

export type RoomDeps = {
  load(pageId: string): Promise<LoadResult>;
  readMeta(pageId: string): Promise<MetaResult>;
  persist(input: PersistInput): Promise<PersistOutcome>;
  revalidate(
    identity: ConnectionIdentity,
    meta: PageMeta,
  ): Promise<RevalidateResult>;
  channel: DocChannel;
  /** Handles a message from another instance (the fan-out rules). */
  onDocBroadcast(room: PageRoom, message: DocBroadcast): void;
  /** The room closed; the registry forgets it. */
  onClosed(room: PageRoom): void;
};

/** The origin of changes that came from another instance. */
export class RemoteOrigin {
  constructor(readonly userId: string | null) {}
}

/** Awareness removals of a connection that closed. */
const CLOSE_ORIGIN = "close";
/** Awareness states that came from another instance. */
const REMOTE_AWARENESS_ORIGIN = "remote";
/** Frames queued per connection while the room loads. */
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

type ServerChangeRun = {
  actorId: string;
  restore: boolean;
  mutate(doc: Y.Doc): void;
  guard(row: Parameters<NonNullable<PersistInput["guard"]>>[0]): void;
};

type PersistAttempt =
  | { result: "saved"; outcome: Extract<PersistOutcome, { status: "saved" }> }
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

export class PageRoom {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly connections = new Set<PageConnection>();
  /** Resolves true once the room is ready, false when it failed to load. */
  readonly ready: Promise<boolean>;
  meta: PageMeta | null = null;

  private status: "loading" | "ready" | "closed" = "loading";
  private knownContentVersion: number | null = null;
  private dirty = false;
  private generation = 0;
  /** Contributors since the last persist, with the generation of their latest change. */
  private readonly contributors = new Map<string, number>();
  private lastContributor: string | null = null;
  /** The actor of the server change being applied. */
  private serverActor: string | null = null;
  private persistTail: Promise<unknown> = Promise.resolve();
  private readonly scheduler: PersistScheduler;
  private readonly queuedBytes = new WeakMap<PageConnection, number>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private revalidateTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly pageId: string,
    private readonly deps: RoomDeps,
  ) {
    // The server has no presence of its own.
    this.awareness.setLocalState(null);
    this.doc.on("update", (update: Uint8Array, origin: unknown) =>
      this.onDocUpdate(update, origin),
    );
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

  // ---------------------------------------------------------------------
  // Lifecycle

  private async load(): Promise<boolean> {
    let loaded: LoadResult;
    try {
      loaded = await this.deps.load(this.pageId);
    } catch (error) {
      console.error(`Page room ${this.pageId} failed to load:`, error);
      Sentry.captureException(error);
      this.close(COLLAB_CLOSE.internalError, "Couldn't load the page");
      return false;
    }
    if (this.status === "closed") return false;
    if (loaded.status !== "ok") {
      this.close(COLLAB_CLOSE.gone, PAGE_MESSAGES.notFound);
      return false;
    }

    Y.applyUpdate(this.doc, loaded.state, PAGE_DOC_ORIGIN.db);
    this.meta = loaded.meta;
    this.knownContentVersion = loaded.meta.contentVersion;
    try {
      await this.deps.channel.subscribe(this.pageId, (message) =>
        this.deps.onDocBroadcast(this, message),
      );
    } catch (error) {
      console.error(
        `Page room ${this.pageId} channel subscribe failed:`,
        error,
      );
    }
    // Closed (deleted, shut down) while subscribing.
    if (this.isClosed) return false;
    // Catch up with rooms of this page on other instances.
    this.publish({
      kind: "sync-request",
      data: toBase64(Y.encodeStateVector(this.doc)),
    });
    this.publish({ kind: "awareness-query" });

    this.status = "ready";
    console.log(`Page room ${this.pageId} loaded`);
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

  /**
   * Closes every local connection with `code` and unloads the room without
   * persisting (callers flush first when they want the edits saved).
   */
  close(code: number, reason: string) {
    if (this.status === "closed") return;
    this.status = "closed";
    this.scheduler.stop();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const connection of this.connections) connection.close(code, reason);
    this.connections.clear();
    void this.deps.channel.unsubscribe(this.pageId).catch((error) => {
      console.error(`Page room ${this.pageId} unsubscribe failed:`, error);
    });
    // Destroying the doc destroys its awareness too.
    this.doc.destroy();
    this.deps.onClosed(this);
    console.log(`Page room ${this.pageId} unloaded (${code})`);
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = unrefTimer(
      setTimeout(() => {
        this.idleTimer = null;
        if (this.status !== "ready" || this.connections.size > 0) return;
        // Unsaved edits keep the room until a persist succeeds.
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

  // ---------------------------------------------------------------------
  // Connections

  /** Adds a socket; false (and closed) when the room is full or closed. */
  addConnection(connection: PageConnection): boolean {
    if (this.status === "closed") {
      connection.close(COLLAB_CLOSE.restarting, "Reconnect");
      return false;
    }
    if (this.connections.size >= COLLAB_LIMITS.connectionsPerRoom) {
      connection.close(
        COLLAB_CLOSE.roomFull,
        "Too many people have this page open",
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

  removeConnection(connection: PageConnection) {
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

  /** Sync step 1, the known awareness states, then the `state` control. */
  private greet(connection: PageConnection) {
    const meta = this.meta;
    if (connection.closed || connection.greeted || !meta) return;
    if (!canSeePage(meta, connection.caller)) {
      connection.close(COLLAB_CLOSE.forbidden, PAGE_MESSAGES.notFound);
      return;
    }
    connection.canWrite = canWriteFor(meta, connection.caller);
    connection.greeted = true;
    connection.send(encodeSyncStep1(this.doc));
    const clients = [...this.awareness.getStates().keys()];
    if (clients.length > 0) {
      connection.send(
        encodeAwarenessMessage(
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients),
        ),
      );
    }
    connection.sendControl(stateMessage(meta, connection.canWrite));
    for (const frame of connection.queue.splice(0)) {
      this.process(connection, frame);
    }
    this.queuedBytes.delete(connection);
  }

  /** A binary frame from a connection. */
  receive(connection: PageConnection, frame: Uint8Array) {
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

  private process(connection: PageConnection, frame: Uint8Array) {
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

  private receiveUpdate(connection: PageConnection, update: Uint8Array) {
    if (connection.canWrite) {
      Y.applyUpdate(this.doc, update, connection);
      return;
    }
    // A read-only socket's edits are never applied. Its offline edits get a
    // notice, at most once a minute.
    const meta = this.meta;
    if (
      meta &&
      updateHasNewContent(this.doc, update) &&
      connection.mayNotifyOfflineRejected()
    ) {
      connection.sendControl({
        kind: "offline-rejected",
        reason: offlineRejectedReason(meta),
      });
    }
  }

  private controllerOf(clientId: number): PageConnection | undefined {
    for (const connection of this.connections) {
      if (connection.controlled.has(clientId)) return connection;
    }
    return undefined;
  }

  private receiveAwareness(connection: PageConnection, update: Uint8Array) {
    const verdict = checkAwarenessUpdate(decodeAwarenessUpdate(update), {
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
      // The same user's reconnecting tab takes its client id over.
      this.controllerOf(clientId)?.controlled.delete(clientId);
      connection.controlled.add(clientId);
    }
    awarenessProtocol.applyAwarenessUpdate(this.awareness, update, connection);
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

  // ---------------------------------------------------------------------
  // Fan-out

  private sendToAll(frame: Uint8Array, except?: PageConnection) {
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
    this.deps.channel.publish({ ...message, pageId: this.pageId });
  }

  private onDocUpdate(update: Uint8Array, origin: unknown) {
    if (this.status === "closed") return;
    const frame = encodeSyncUpdate(update);
    if (origin instanceof RemoteOrigin) {
      this.sendToAll(frame);
      this.markDirty(origin.userId);
      return;
    }
    if (origin === PAGE_DOC_ORIGIN.server) {
      // Persisted by the server change that made it.
      this.sendToAll(frame);
      this.publish({
        kind: "update",
        userId: this.serverActor ?? undefined,
        data: toBase64(update),
      });
      return;
    }
    if (origin instanceof PageConnection) {
      this.sendToAll(frame, origin);
      this.publish({
        kind: "update",
        userId: origin.userId,
        data: toBase64(update),
      });
      this.markDirty(origin.userId);
      return;
    }
    // The database (load, the persist pull).
    this.sendToAll(frame);
  }

  private onAwarenessUpdate(
    {
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    },
    origin: unknown,
  ) {
    if (this.status === "closed") return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    const update = awarenessProtocol.encodeAwarenessUpdate(
      this.awareness,
      changed,
    );
    // The sender too: the client's watchdog counts its echoed renewals.
    this.sendToAll(encodeAwarenessMessage(update));
    if (origin !== REMOTE_AWARENESS_ORIGIN && origin !== "timeout") {
      this.publish({ kind: "awareness", data: toBase64(update) });
    }
  }

  /** Applies an update from another instance. */
  applyRemoteUpdate(update: Uint8Array, userId: string | null) {
    if (this.status === "closed") return;
    Y.applyUpdate(this.doc, update, new RemoteOrigin(userId));
  }

  /** Applies awareness states from another instance. */
  applyRemoteAwareness(update: Uint8Array) {
    if (this.status === "closed") return;
    awarenessProtocol.applyAwarenessUpdate(
      this.awareness,
      update,
      REMOTE_AWARENESS_ORIGIN,
    );
  }

  /** The awareness update of the states local connections control. */
  localAwarenessUpdate(): Uint8Array | null {
    const clients = [...this.connections].flatMap((connection) => [
      ...connection.controlled,
    ]);
    const present = clients.filter((id) => this.awareness.states.has(id));
    return present.length > 0
      ? awarenessProtocol.encodeAwarenessUpdate(this.awareness, present)
      : null;
  }

  /** What `stateVector` lacks of this room's doc. */
  diffAgainst(stateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, stateVector);
  }

  // ---------------------------------------------------------------------
  // Persistence (pull, merge, push; spec §5.5)

  private markDirty(userId: string | null) {
    this.generation++;
    this.dirty = true;
    if (userId) {
      this.contributors.set(userId, this.generation);
      this.lastContributor = userId;
    }
    this.scheduler.changed();
  }

  /** Persists are serialized: scheduled ones and server changes. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.persistTail.then(task, task);
    this.persistTail = run.catch(() => {});
    return run;
  }

  private async persistDirty(): Promise<PersistResult> {
    const attempt = await this.serialize(() => this.persistOnce());
    if (attempt.result === "failed") {
      console.error(`Page room ${this.pageId} persist failed:`, attempt.error);
      Sentry.captureException(attempt.error);
      return "failed";
    }
    return attempt.result === "saved" ? "saved" : "idle";
  }

  private async persistOnce(change?: ServerChangeRun): Promise<PersistAttempt> {
    if (this.status !== "ready") return { result: "idle" };
    if (!change && !this.dirty) return { result: "idle" };

    // Attribution and the dirty generation are taken when the state is
    // encoded (right after `mutate`), so edits that arrive while the row
    // lock is awaited are attributed and cleared correctly.
    const snapshot = {
      generation: this.generation,
      actorId: change?.actorId ?? this.lastContributor,
      contributorIds: change ? [change.actorId] : [...this.contributors.keys()],
    };
    const started = Date.now();
    let outcome: PersistOutcome;
    try {
      outcome = await this.deps.persist({
        pageId: this.pageId,
        doc: this.doc,
        knownContentVersion: this.knownContentVersion,
        guard: change?.guard,
        mutate: (doc) => {
          if (change) {
            this.serverActor = change.actorId;
            try {
              change.mutate(doc);
            } finally {
              this.serverActor = null;
            }
          } else {
            snapshot.actorId = this.lastContributor;
            snapshot.contributorIds = [...this.contributors.keys()];
          }
          snapshot.generation = this.generation;
        },
        get actorId() {
          return snapshot.actorId;
        },
        get contributorIds() {
          return snapshot.contributorIds;
        },
        restore: change?.restore ?? false,
      });
    } catch (error) {
      if (error instanceof PageTooLargeError) {
        this.closeTooLarge();
        return { result: "closed", reason: "too-large" };
      }
      return { result: "failed", error };
    }

    if (outcome.status !== "saved") {
      this.close(COLLAB_CLOSE.gone, PAGE_MESSAGES.notFound);
      return { result: "closed", reason: outcome.status };
    }

    this.knownContentVersion = outcome.contentVersion;
    if (this.generation === snapshot.generation) this.dirty = false;
    for (const [userId, generation] of this.contributors) {
      if (generation <= snapshot.generation) this.contributors.delete(userId);
    }
    console.log(
      `Page room ${this.pageId} persisted v${outcome.contentVersion} (${Date.now() - started} ms)`,
    );
    // The row was read under the lock: a lost meta message heals here.
    this.applyMeta(metaOf(outcome.page));
    this.broadcastControl({
      kind: "saved",
      at: new Date().toISOString(),
      contentVersion: outcome.contentVersion,
    });
    return { result: "saved", outcome };
  }

  private closeTooLarge() {
    this.broadcastControl({
      kind: "too-large",
      limitBytes: COLLAB_LIMITS.docStateBytes,
    });
    this.close(COLLAB_CLOSE.tooLarge, PAGE_MESSAGES.tooLarge);
  }

  /**
   * Applies a REST content change (restore or replace) through the live
   * doc: one transaction with origin `server` under the persist's row lock,
   * then the `restored` or `replaced` notice. Null when the room is gone.
   */
  async applyServerChange(
    change: ServerChange,
  ): Promise<ServerChangeResult | null> {
    if (!(await this.ready) || this.status !== "ready") return null;
    return this.serialize(async () => {
      // Pending edits are saved first, attributed to their authors.
      if (this.dirty) await this.persistOnce();
      const attempt = await this.persistOnce({
        actorId: change.actorId,
        restore: change.kind === "restore",
        guard: (row) => {
          const error = editableStateError(row);
          if (error) throw new HTTPException(409, { message: error });
        },
        mutate: (doc) =>
          applyJsonToYDoc(doc, change.target, PAGE_DOC_ORIGIN.server),
      });
      switch (attempt.result) {
        case "idle":
          return null;
        case "failed":
          throw attempt.error;
        case "closed":
          if (attempt.reason === "too-large") throw new PageTooLargeError(0);
          if (attempt.reason === "feature-off") {
            throw new HTTPException(403, {
              message: featureDisabledMessage("pages"),
            });
          }
          throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
      }
      this.broadcastControl(
        change.kind === "restore"
          ? {
              kind: "restored",
              versionId: change.versionId,
              actorId: change.actorId,
            }
          : { kind: "replaced", actorId: change.actorId },
      );
      return {
        contentVersion: attempt.outcome.contentVersion,
        changed: attempt.outcome.changed,
      };
    });
  }

  /** The live document, persisted first; null when the room is gone. */
  async liveDocument(): Promise<PageDocument | null> {
    await this.flush();
    if (this.status !== "ready") return null;
    return yDocToJson(this.doc);
  }

  // ---------------------------------------------------------------------
  // Meta and revalidation

  /** Takes a fresh meta; connections that lost the page close with 4403. */
  applyMeta(meta: PageMeta) {
    const changed = metaStateChanged(this.meta, meta);
    this.meta = meta;
    for (const connection of this.connections) {
      this.syncConnectionState(connection, changed);
    }
  }

  private syncConnectionState(connection: PageConnection, force: boolean) {
    const meta = this.meta;
    if (!meta || connection.closed || !connection.greeted) return;
    if (!canSeePage(meta, connection.caller)) {
      connection.close(COLLAB_CLOSE.forbidden, PAGE_MESSAGES.notFound);
      return;
    }
    const canWrite = canWriteFor(meta, connection.caller);
    if (!force && canWrite === connection.canWrite) return;
    connection.canWrite = canWrite;
    connection.sendControl(stateMessage(meta, canWrite));
  }

  /** Re-reads the page (after a page event), then every connection's access. */
  async refresh() {
    if (!(await this.ready) || this.status !== "ready") return;
    const result = await this.deps.readMeta(this.pageId);
    if (this.status !== "ready") return;
    if (result.status !== "ok") {
      this.close(COLLAB_CLOSE.gone, PAGE_MESSAGES.notFound);
      return;
    }
    this.applyMeta(result.meta);
    await this.revalidateAll();
  }

  /** Re-checks every connection's credentials, membership and permissions. */
  async revalidateAll() {
    const meta = this.meta;
    if (!meta || this.status !== "ready") return;
    await Promise.all(
      [...this.connections].map(async (connection) => {
        if (connection.closed) return;
        // The timer's check and a page event's check can overlap: a result
        // older than one already applied read older roles, so it is dropped.
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
          console.error(`Page room ${this.pageId} revalidation failed:`, error);
        }
      }),
    );
  }
}
