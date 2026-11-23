import { beforeEach, describe, expect, it, vi } from "vitest";

// The database answers the password-confirmation lookup with queued rows.
const state = vi.hoisted(() => ({ rows: [] as unknown[][], lookups: 0 }));

vi.mock("../../../apps/api/src/database", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => {
      state.lookups += 1;
      return state.rows.shift() ?? [];
    },
  };
  return { default: chain };
});
vi.mock("../../../apps/api/src/instance-admin/audit", () => ({
  recordInstanceAudit: vi.fn(),
}));

const { hasRecentAuth, REAUTH_WINDOW_MS } = await import(
  "../../../apps/api/src/instance-admin/reauth"
);

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const openedAgo = (ms: number) => ({
  id: "session-1",
  createdAt: new Date(NOW - ms),
});

beforeEach(() => {
  state.rows = [];
  state.lookups = 0;
});

describe("the instance-admin re-authentication window", () => {
  it("lets a session opened a few minutes ago through without a lookup", async () => {
    expect(await hasRecentAuth(openedAgo(3 * 60_000), NOW)).toBe(true);
    expect(
      await hasRecentAuth(
        { id: "s", createdAt: new Date(NOW - 60_000).toISOString() },
        NOW,
      ),
    ).toBe(true);
    expect(state.lookups).toBe(0);
  });

  it("asks again once the window has passed, unless the password was confirmed", async () => {
    expect(await hasRecentAuth(openedAgo(REAUTH_WINDOW_MS), NOW)).toBe(false);
    state.rows.push([{ id: "confirmation" }]);
    expect(await hasRecentAuth(openedAgo(60 * 60_000), NOW)).toBe(true);
    expect(state.lookups).toBe(2);
  });

  it("is ten minutes long", () => {
    expect(REAUTH_WINDOW_MS).toBe(10 * 60_000);
  });
});
