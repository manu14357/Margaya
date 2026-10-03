import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import {
  CONTROL_MESSAGE_TYPE,
  isTerminalClose,
  presenceFromStates,
  readControlMessage,
  terminalKind,
} from "./collab-protocol";

function controlFrame(payload: string) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, CONTROL_MESSAGE_TYPE);
  encoding.writeVarString(encoder, payload);
  const decoder = decoding.createDecoder(encoding.toUint8Array(encoder));
  expect(decoding.readVarUint(decoder)).toBe(CONTROL_MESSAGE_TYPE);
  return decoder;
}

describe("readControlMessage", () => {
  it("reads a control message after its type", () => {
    const message = readControlMessage(
      controlFrame(
        JSON.stringify({ kind: "saved", at: "x", contentVersion: 3 }),
      ),
    );
    expect(message).toEqual({ kind: "saved", at: "x", contentVersion: 3 });
  });

  it("ignores unknown kinds and malformed JSON", () => {
    expect(readControlMessage(controlFrame('{"kind":"later"}'))).toBeNull();
    expect(readControlMessage(controlFrame("not json"))).toBeNull();
  });
});

describe("close codes", () => {
  it("treats 4400-4499, 1003, 1008 and 1009 as terminal", () => {
    for (const code of [4401, 4403, 4404, 4413, 4429, 1003, 1008, 1009]) {
      expect(isTerminalClose(code)).toBe(true);
    }
    for (const code of [1000, 1001, 1006, 1011, 4503, 4529]) {
      expect(isTerminalClose(code)).toBe(false);
    }
  });

  it("maps codes to what the page shows", () => {
    expect(terminalKind(4401)).toBe("signedOut");
    expect(terminalKind(4403)).toBe("notVisible");
    expect(terminalKind(4404)).toBe("gone");
    expect(terminalKind(4413)).toBe("tooLarge");
    expect(terminalKind(1009)).toBe("tooLarge");
    expect(terminalKind(4429)).toBe("roomFull");
    expect(terminalKind(1008)).toBe("protocol");
  });
});

describe("presenceFromStates", () => {
  it("drops the local client, duplicates and unknown people", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: "me", color: "blue" } }],
      [2, { user: { id: "ann", color: "rose" } }],
      [3, { user: { id: "ann", color: "rose" } }],
      [4, { user: { id: "ghost", color: "teal" } }],
      [5, { user: { id: "bob", color: "#ff0000" } }],
      [6, {}],
    ]);
    const presence = presenceFromStates(states, 1, (id) => id !== "ghost");
    expect(presence).toEqual([
      { userId: "ann", color: "rose" },
      { userId: "bob", color: "blue" },
    ]);
  });
});
