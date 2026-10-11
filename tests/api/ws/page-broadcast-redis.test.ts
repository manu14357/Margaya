import { describe, expect, it, vi } from "vitest";

const listeners: Array<(p: string, c: string, d: string) => void> = [];
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
  getRedisPub: () => ({ publish: vi.fn() }),
  getRedisSub: () => subscriber,
  closeRedis: vi.fn().mockResolvedValue(undefined),
}));

import type { BroadcastMessage } from "../../../apps/api/src/ws/broadcast-adapter";
import { RedisBroadcastAdapter } from "../../../apps/api/src/ws/redis-broadcast-adapter";

describe("page hints over Redis", () => {
  it("keeps pageId through the project channel schema", async () => {
    const adapter = new RedisBroadcastAdapter();
    const received: BroadcastMessage[] = [];
    await adapter.subscribe((message) => received.push(message));

    const message = {
      projectId: "proj-1",
      message: { type: "PAGE_UPDATED", projectId: "proj-1", pageId: "page-1" },
      excludeInitiatorId: "user-1:window-1",
    };
    for (const listener of listeners) {
      listener(
        "margaya:ws:*:broadcast",
        "margaya:ws:proj-1:broadcast",
        JSON.stringify(message),
      );
    }
    expect(received).toEqual([message]);
    await adapter.shutdown();
  });
});
