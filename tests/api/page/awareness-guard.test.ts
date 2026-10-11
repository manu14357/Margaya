import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import {
  type AwarenessEntry,
  type AwarenessGuardContext,
  checkAwarenessUpdate,
  decodeAwarenessUpdate,
  invalidAwarenessState,
} from "../../../apps/api/src/page/collab/awareness-guard";

const valid = { user: { id: "u1", color: "blue" } };

function context(
  overrides: Partial<AwarenessGuardContext> = {},
): AwarenessGuardContext {
  return {
    userId: "u1",
    controlled: new Set<number>(),
    known: () => undefined,
    controlledByOther: () => undefined,
    ...overrides,
  };
}

function entry(clientId: number, state: unknown, clock = 1): AwarenessEntry {
  return { clientId, clock, state };
}

function encode(
  entries: Array<{ clientId: number; clock: number; json: string }>,
) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const { clientId, clock, json } of entries) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, json);
  }
  return encoding.toUint8Array(encoder);
}

describe("awareness states", () => {
  it("accepts the user's own id with a palette color, and a cursor", () => {
    expect(invalidAwarenessState(valid, "u1")).toBeNull();
    expect(
      invalidAwarenessState(
        { ...valid, cursor: { anchor: { a: 1 }, head: { b: 2 } } },
        "u1",
      ),
    ).toBeNull();
    expect(invalidAwarenessState({ ...valid, cursor: null }, "u1")).toBeNull();
    // The provider's initial empty state carries nothing to spoof.
    expect(invalidAwarenessState({}, "u1")).toBeNull();
  });

  it("rejects spoofed users, unknown keys, CSS colors and malformed cursors", () => {
    expect(
      invalidAwarenessState({ user: { id: "u2", color: "blue" } }, "u1"),
    ).toMatch(/user.id/);
    expect(
      invalidAwarenessState({ user: { id: "u1", color: "#f00" } }, "u1"),
    ).toMatch(/palette/);
    expect(
      invalidAwarenessState(
        { user: { id: "u1", color: "blue", name: "Mallory" } },
        "u1",
      ),
    ).toMatch(/unknown user key/);
    expect(invalidAwarenessState({ ...valid, avatar: "x" }, "u1")).toMatch(
      /unknown key/,
    );
    expect(invalidAwarenessState({ cursor: null }, "u1")).toMatch(/required/);
    expect(
      invalidAwarenessState({ ...valid, cursor: { anchor: 1 } }, "u1"),
    ).toMatch(/anchor and head/);
    expect(invalidAwarenessState("text", "u1")).toMatch(/object/);
    expect(invalidAwarenessState([valid], "u1")).toMatch(/object/);
  });
});

describe("decodeAwarenessUpdate", () => {
  it("decodes entries and refuses an entry over 8 KiB", () => {
    const entries = decodeAwarenessUpdate(
      encode([{ clientId: 7, clock: 3, json: JSON.stringify(valid) }]),
    );
    expect(entries).toEqual([{ clientId: 7, clock: 3, state: valid }]);
    const big = JSON.stringify({ user: { id: "u1", color: "x".repeat(9000) } });
    expect(() =>
      decodeAwarenessUpdate(encode([{ clientId: 7, clock: 3, json: big }])),
    ).toThrow(/too large/);
  });
});

describe("checkAwarenessUpdate", () => {
  it("applies a valid state and claims a new client id", () => {
    expect(checkAwarenessUpdate([entry(10, valid)], context())).toEqual({
      kind: "apply",
      claimed: [10],
    });
  });

  it("drops the whole message for any invalid entry", () => {
    const verdict = checkAwarenessUpdate(
      [entry(10, valid), entry(11, { user: { id: "u2", color: "blue" } })],
      context(),
    );
    expect(verdict.kind).toBe("drop");
  });

  it("allows a null state only for a controlled client id", () => {
    expect(
      checkAwarenessUpdate(
        [entry(10, null, 2)],
        context({
          controlled: new Set([10]),
          known: () => ({ clock: 1, hasState: true }),
        }),
      ),
    ).toEqual({ kind: "apply", claimed: [] });
    expect(
      checkAwarenessUpdate(
        [entry(20, null, 2)],
        context({ known: () => ({ clock: 1, hasState: true }) }),
      ).kind,
    ).toBe("drop");
  });

  it("ignores echoes the room already has (other users' states included)", () => {
    const verdict = checkAwarenessUpdate(
      [entry(30, { user: { id: "u2", color: "rose" } }, 4), entry(31, null, 2)],
      context({
        known: (clientId) =>
          clientId === 30
            ? { clock: 4, hasState: true }
            : { clock: 2, hasState: false },
      }),
    );
    expect(verdict).toEqual({ kind: "ignore" });
  });

  it("never takes over another user's client id", () => {
    expect(
      checkAwarenessUpdate(
        [entry(40, valid, 5)],
        context({
          known: () => ({ clock: 4, hasState: true }),
          controlledByOther: () => "u2",
        }),
      ).kind,
    ).toBe("drop");
    // The same user's reconnecting socket may.
    expect(
      checkAwarenessUpdate(
        [entry(40, valid, 5)],
        context({
          known: () => ({ clock: 4, hasState: true }),
          controlledByOther: () => "u1",
        }),
      ),
    ).toEqual({ kind: "apply", claimed: [40] });
  });

  it("caps a connection at four client ids", () => {
    const controlled = new Set([1, 2, 3]);
    expect(
      checkAwarenessUpdate([entry(4, valid)], context({ controlled })),
    ).toEqual({ kind: "apply", claimed: [4] });
    expect(
      checkAwarenessUpdate(
        [entry(4, valid), entry(5, valid)],
        context({ controlled }),
      ),
    ).toEqual({ kind: "too-many-clients" });
  });
});
