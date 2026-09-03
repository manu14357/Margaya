import type Redis from "ioredis";
import * as v from "valibot";
import { closeRedis, getRedisPub, getRedisSub } from "../redis";
import {
  type BroadcastAdapter,
  type BroadcastMessage,
  DOC_BROADCAST_KINDS,
  type DocBroadcast,
  type UserBroadcast,
} from "./broadcast-adapter";

const CHANNEL_PREFIX = "margaya:ws:";
const CHANNEL_SUFFIX = ":broadcast";
const CHANNEL_PATTERN = `${CHANNEL_PREFIX}*${CHANNEL_SUFFIX}`;

const USER_CHANNEL_PREFIX = "margaya:ws-user:";
const USER_CHANNEL_PATTERN = `${USER_CHANNEL_PREFIX}*${CHANNEL_SUFFIX}`;

// One plain channel per loaded page room (never a pattern, so an instance
// only receives the traffic of pages it hosts).
const DOC_CHANNEL_PREFIX = "margaya:ws-doc:";
/** Base64 data of one document message (an update is at most 5 MiB). */
const DOC_DATA_MAX_CHARS = 8 * 1024 * 1024;

const docBroadcastSchema = v.object({
  pageId: v.string(),
  origin: v.string(),
  kind: v.picklist(DOC_BROADCAST_KINDS),
  target: v.optional(v.string()),
  userId: v.optional(v.string()),
  data: v.optional(v.pipe(v.string(), v.maxLength(DOC_DATA_MAX_CHARS))),
  deleted: v.optional(v.boolean()),
});

const broadcastMessageSchema = v.object({
  projectId: v.string(),
  message: v.object({
    type: v.string(),
    projectId: v.string(),
    taskId: v.optional(v.string()),
    sourceTaskId: v.optional(v.string()),
    targetTaskId: v.optional(v.string()),
    pageId: v.optional(v.string()),
  }),
  excludeInitiatorId: v.optional(v.string()),
});

const userBroadcastSchema = v.object({
  userId: v.string(),
  message: v.looseObject({ type: v.string() }),
  origin: v.optional(v.string()),
});

export class RedisBroadcastAdapter implements BroadcastAdapter {
  private subscribed = false;
  private userSubscribed = false;
  private _pmessageHandler:
    | ((pattern: string, channel: string, data: string) => void)
    | null = null;
  private _userPmessageHandler:
    | ((pattern: string, channel: string, data: string) => void)
    | null = null;
  private _docMessageHandler: ((channel: string, data: string) => void) | null =
    null;
  private readonly docHandlers = new Map<string, (msg: DocBroadcast) => void>();

  async publish(msg: BroadcastMessage): Promise<void> {
    await getRedisPub().publish(
      this.channelForProject(msg.projectId),
      JSON.stringify(msg),
    );
  }

  async publishToUser(msg: UserBroadcast): Promise<void> {
    await getRedisPub().publish(
      this.channelForUser(msg.userId),
      JSON.stringify(msg),
    );
  }

  async subscribe(handler: (msg: BroadcastMessage) => void): Promise<void> {
    if (this.subscribed) return;
    this.subscribed = true;

    // Pattern-subscribe to ALL project channels at once
    // "pmessage" fires for pattern subscriptions (not "message")
    this._pmessageHandler = (
      pattern: string,
      _channel: string,
      data: string,
    ) => {
      if (pattern !== CHANNEL_PATTERN) return;
      try {
        const parsed = v.safeParse(broadcastMessageSchema, JSON.parse(data));
        if (!parsed.success) {
          console.error("Invalid broadcast message:", parsed.issues);
          return;
        }
        handler(parsed.output);
      } catch (err) {
        console.error("Failed to parse broadcast message:", err);
      }
    };
    (getRedisSub() as Redis).on("pmessage", this._pmessageHandler);
    await getRedisSub().psubscribe(CHANNEL_PATTERN);
  }

  async subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void> {
    if (this.userSubscribed) return;
    this.userSubscribed = true;

    this._userPmessageHandler = (
      pattern: string,
      channel: string,
      data: string,
    ) => {
      if (pattern !== USER_CHANNEL_PATTERN) return;
      try {
        const parsed = v.safeParse(userBroadcastSchema, JSON.parse(data));
        if (!parsed.success) {
          console.error("Invalid user broadcast message:", parsed.issues);
          return;
        }
        if (channel !== this.channelForUser(parsed.output.userId)) {
          console.error("User broadcast channel and payload disagree");
          return;
        }
        handler(parsed.output as UserBroadcast);
      } catch (err) {
        console.error("Failed to parse user broadcast message:", err);
      }
    };
    (getRedisSub() as Redis).on("pmessage", this._userPmessageHandler);
    await getRedisSub().psubscribe(USER_CHANNEL_PATTERN);
  }

  async publishDoc(msg: DocBroadcast): Promise<void> {
    await getRedisPub().publish(
      this.channelForDoc(msg.pageId),
      JSON.stringify(msg),
    );
  }

  async subscribeToDoc(
    pageId: string,
    handler: (msg: DocBroadcast) => void,
  ): Promise<void> {
    if (!this._docMessageHandler) {
      this._docMessageHandler = (channel: string, data: string) =>
        this.receiveDoc(channel, data);
      (getRedisSub() as Redis).on("message", this._docMessageHandler);
    }
    const subscribed = this.docHandlers.has(pageId);
    this.docHandlers.set(pageId, handler);
    if (!subscribed) await getRedisSub().subscribe(this.channelForDoc(pageId));
  }

  async unsubscribeFromDoc(pageId: string): Promise<void> {
    if (!this.docHandlers.delete(pageId)) return;
    await getRedisSub().unsubscribe(this.channelForDoc(pageId));
  }

  private receiveDoc(channel: string, data: string) {
    if (!channel.startsWith(DOC_CHANNEL_PREFIX)) return;
    const pageId = channel.slice(
      DOC_CHANNEL_PREFIX.length,
      -CHANNEL_SUFFIX.length,
    );
    const handler = this.docHandlers.get(pageId);
    if (!handler) return;
    // Bounded before parsing: the base64 data plus a small envelope.
    if (data.length > DOC_DATA_MAX_CHARS + 4096) {
      console.error("Dropped an oversized document message");
      return;
    }
    try {
      const parsed = v.safeParse(docBroadcastSchema, JSON.parse(data));
      if (!parsed.success) {
        console.error("Invalid document message:", parsed.issues);
        return;
      }
      if (parsed.output.pageId !== pageId) {
        console.error("Document channel and payload disagree");
        return;
      }
      handler(parsed.output);
    } catch (err) {
      console.error("Failed to handle a document message:", err);
    }
  }

  async shutdown(): Promise<void> {
    const sub = getRedisSub() as Redis;

    if (this._docMessageHandler) {
      sub.off("message", this._docMessageHandler);
      this._docMessageHandler = null;
    }
    const docChannels = [...this.docHandlers.keys()].map((pageId) =>
      this.channelForDoc(pageId),
    );
    this.docHandlers.clear();
    if (docChannels.length > 0) await sub.unsubscribe(...docChannels);

    if (this._pmessageHandler) {
      sub.off("pmessage", this._pmessageHandler);
      this._pmessageHandler = null;
    }
    if (this._userPmessageHandler) {
      sub.off("pmessage", this._userPmessageHandler);
      this._userPmessageHandler = null;
    }

    // Unsubscribe from the pattern, which covers all project channels
    await getRedisSub().punsubscribe(CHANNEL_PATTERN);
    await getRedisSub().punsubscribe(USER_CHANNEL_PATTERN);
    this.subscribed = false;
    this.userSubscribed = false;
    await closeRedis();
  }

  private channelForProject(projectId: string): string {
    return `${CHANNEL_PREFIX}${projectId}${CHANNEL_SUFFIX}`;
  }

  private channelForUser(userId: string): string {
    return `${USER_CHANNEL_PREFIX}${userId}${CHANNEL_SUFFIX}`;
  }

  private channelForDoc(pageId: string): string {
    return `${DOC_CHANNEL_PREFIX}${pageId}${CHANNEL_SUFFIX}`;
  }
}
