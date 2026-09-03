export type ProjectBroadcastMessage = {
  type: string;
  projectId: string;
  taskId?: string;
  sourceTaskId?: string;
  targetTaskId?: string;
  /** Page hints (PAGE_UPDATED, PAGE_DELETED). */
  pageId?: string;
};

export type BroadcastMessage = {
  projectId: string;
  message: ProjectBroadcastMessage;
  excludeInitiatorId?: string;
};

export type UserBroadcastMessage = {
  type: string;
  [key: string]: unknown;
};

export type UserBroadcast = {
  userId: string;
  message: UserBroadcastMessage;
  origin?: string;
};

export type BroadcastAdapter = {
  /** Publish a message to all instances watching this project */
  publish(msg: BroadcastMessage): Promise<void>;

  publishToUser(msg: UserBroadcast): Promise<void>;

  /** Subscribe to messages for delivery to local connections */
  subscribe(handler: (msg: BroadcastMessage) => void): Promise<void>;

  subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void>;

  /**
   * Document channel (page collaboration): sends to every other instance
   * that hosts the page's room. Single-instance adapters do nothing.
   */
  publishDoc(msg: DocBroadcast): Promise<void>;

  /** Starts receiving one page's document messages (at room load). */
  subscribeToDoc(
    pageId: string,
    handler: (msg: DocBroadcast) => void,
  ): Promise<void>;

  /** Stops receiving them (at room unload). */
  unsubscribeFromDoc(pageId: string): Promise<void>;

  /** Cleanup on shutdown */
  shutdown(): Promise<void>;
};

export const DOC_BROADCAST_KINDS = [
  "update",
  "awareness",
  "sync-request",
  "sync-reply",
  "awareness-query",
  "meta",
] as const;

export type DocBroadcastKind = (typeof DOC_BROADCAST_KINDS)[number];

/** A page room message between instances. */
export type DocBroadcast = {
  pageId: string;
  /** The sending instance; receivers drop their own messages. */
  origin: string;
  kind: DocBroadcastKind;
  /** The only instance that should handle it (sync replies). */
  target?: string;
  /** The contributor of an `update`. */
  userId?: string;
  /** Base64 of the Yjs update, the awareness update or the state vector. */
  data?: string;
  /** `meta`: the page was deleted. */
  deleted?: boolean;
};
