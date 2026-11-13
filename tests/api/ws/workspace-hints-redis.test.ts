import { describe, expect, it, vi } from "vitest";

// The workspace-wide hints ride the user channel. With several API
// instances they cross Redis, whose user schema keeps unknown fields.

const listeners: Array<(p: string, c: string, d: string) => void> = [];
const publish = vi.fn().mockResolvedValue(1);
const subscriber = {
  psubscribe: vi.fn().mockResolvedValue(undefined),
  punsubscribe: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((event: string, fn: (p: string, c: string, d: string) => void) => {
    if (event === "pmessage") listeners.push(fn);
  }),
  off: vi.fn(),
};

vi.mock("../../../apps/api/src/redis", () => ({
  isRedisConfigured: () => true,
  getRedisPub: () => ({ publish }),
  getRedisSub: () => subscriber,
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

import type { UserBroadcast } from "../../../apps/api/src/ws/broadcast-adapter";
import { RedisBroadcastAdapter } from "../../../apps/api/src/ws/redis-broadcast-adapter";

describe("workspace hints over Redis", () => {
  it.each([
    { type: "USER_PROFILE_UPDATED", userId: "alice" },
    { type: "PROJECTS_UPDATED", workspaceId: "ws-1" },
    { type: "REFERENCES_UPDATED", workspaceId: "ws-1" },
  ])("delivers $type with its ids to the other instance", async (message) => {
    const adapter = new RedisBroadcastAdapter();
    const received: UserBroadcast[] = [];
    await adapter.subscribeToUser((msg) => received.push(msg));

    const broadcast = { userId: "bob", message, origin: "instance-a" };
    await adapter.publishToUser(broadcast);
    const [channel, data] = publish.mock.calls.at(-1) ?? [];
    for (const listener of listeners) {
      listener("margaya:ws-user:*:broadcast", channel, data);
    }

    expect(received).toEqual([broadcast]);
    listeners.length = 0;
    await adapter.shutdown();
  });
});
