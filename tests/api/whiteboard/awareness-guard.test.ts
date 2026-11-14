import { describe, expect, it } from "vitest";
import {
  BOARD_AWARENESS_LIMITS,
  checkBoardAwareness,
  decodeBoardAwareness,
  encodeBoardAwareness,
  invalidBoardAwarenessState,
  withAccountIdentity,
} from "../../../apps/api/src/whiteboard/collab/awareness-guard";

const user = { id: "u1", name: "Ada", color: "#3b82f6", image: null };

const context = (overrides = {}) => ({
  userId: "u1",
  controlled: new Set<number>(),
  known: () => undefined,
  controlledByOther: () => undefined,
  ...overrides,
});

describe("board awareness states", () => {
  it("accepts the editor's presence state", () => {
    expect(
      invalidBoardAwarenessState(
        {
          user,
          cursor: { x: 10, y: -4.5 },
          selectedIds: ["a", "b"],
          laser: [
            [0, 0],
            [1, 2],
          ],
          following: null,
          // The editor publishes its view so others can follow it.
          viewport: { centerX: 120, centerY: -40, zoom: 1.5 },
        },
        "u1",
      ),
    ).toBeNull();
    expect(
      invalidBoardAwarenessState({ user, viewport: null }, "u1"),
    ).toBeNull();
    expect(invalidBoardAwarenessState({}, "u1")).toBeNull();
    expect(invalidBoardAwarenessState({ user, cursor: null }, "u1")).toBeNull();
  });

  it("refuses another user's id, unknown keys and unsafe colours", () => {
    expect(
      invalidBoardAwarenessState({ user: { ...user, id: "u2" } }, "u1"),
    ).toMatch(/connection's user/);
    expect(invalidBoardAwarenessState({ user, html: "<b>" }, "u1")).toMatch(
      /unknown key/,
    );
    expect(
      invalidBoardAwarenessState({ user: { ...user, role: "admin" } }, "u1"),
    ).toMatch(/unknown user key/);
    expect(
      invalidBoardAwarenessState(
        { user: { ...user, color: "red;background:url(x)" } },
        "u1",
      ),
    ).toMatch(/colour/);
  });

  it("bounds the published viewport", () => {
    for (const viewport of [
      { centerX: 0, centerY: 0 },
      { centerX: 0, centerY: 0, zoom: 0 },
      { centerX: 0, centerY: 0, zoom: -1 },
      { centerX: 0, centerY: 0, zoom: 1e6 },
      { centerX: Number.NaN, centerY: 0, zoom: 1 },
      { centerX: 0, centerY: 0, zoom: 1, extra: true },
      "0,0,1",
    ]) {
      expect(invalidBoardAwarenessState({ user, viewport }, "u1")).toMatch(
        /viewport/,
      );
    }
  });

  it("bounds cursors, selections and laser trails", () => {
    expect(
      invalidBoardAwarenessState(
        { user, cursor: { x: Number.NaN, y: 0 } },
        "u1",
      ),
    ).toMatch(/cursor/);
    expect(
      invalidBoardAwarenessState({ user, cursor: { x: 1, y: 2, z: 3 } }, "u1"),
    ).toMatch(/cursor/);
    expect(
      invalidBoardAwarenessState(
        {
          user,
          selectedIds: Array.from(
            { length: BOARD_AWARENESS_LIMITS.selectedIds + 1 },
            (_, index) => `e${index}`,
          ),
        },
        "u1",
      ),
    ).toMatch(/selectedIds/);
    expect(
      invalidBoardAwarenessState({ user, laser: [[1, 2, 3]] }, "u1"),
    ).toMatch(/laser/);
    expect(
      invalidBoardAwarenessState({ user, following: { id: "x" } }, "u1"),
    ).toMatch(/following/);
  });
});

describe("board awareness updates", () => {
  it("round-trips entries and replaces the name and avatar with the account's", () => {
    const encoded = encodeBoardAwareness([
      { clientId: 7, clock: 1, state: { user: { ...user, name: "Admin" } } },
      { clientId: 8, clock: 4, state: { user: { id: "u2", name: "Bob" } } },
    ]);
    const entries = decodeBoardAwareness(encoded);
    const rewritten = withAccountIdentity(entries, {
      userId: "u1",
      name: "Ada Lovelace",
      image: "/api/user/avatar/a1",
    });
    expect(rewritten[0]?.state).toEqual({
      user: {
        ...user,
        name: "Ada Lovelace",
        image: "/api/user/avatar/a1",
      },
    });
    // Echoes of other people's states are left as they are.
    expect(rewritten[1]?.state).toEqual({ user: { id: "u2", name: "Bob" } });
  });

  it("refuses oversized entries", () => {
    const encoded = encodeBoardAwareness([
      {
        clientId: 1,
        clock: 1,
        state: { user, pad: "x".repeat(BOARD_AWARENESS_LIMITS.entryBytes) },
      },
    ]);
    expect(() => decodeBoardAwareness(encoded)).toThrow(/too large/);
  });

  it("claims fresh client ids and drops states for other users", () => {
    expect(
      checkBoardAwareness(
        [{ clientId: 3, clock: 1, state: { user } }],
        context(),
      ),
    ).toEqual({ kind: "apply", claimed: [3] });
    expect(
      checkBoardAwareness(
        [{ clientId: 3, clock: 1, state: { user: { ...user, id: "u2" } } }],
        context(),
      ).kind,
    ).toBe("drop");
    expect(
      checkBoardAwareness(
        [{ clientId: 3, clock: 2, state: { user } }],
        context({ controlledByOther: () => "u2" }),
      ),
    ).toEqual({ kind: "drop", reason: "client id belongs to another user" });
    expect(
      checkBoardAwareness(
        [{ clientId: 3, clock: 1, state: { user } }],
        context({ known: () => ({ clock: 5, hasState: true }) }),
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("refuses a connection that controls too many client ids", () => {
    const entries = [1, 2, 3, 4, 5].map((clientId) => ({
      clientId,
      clock: 1,
      state: { user },
    }));
    expect(checkBoardAwareness(entries, context()).kind).toBe(
      "too-many-clients",
    );
  });
});
