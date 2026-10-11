import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import {
  decodeClientMessage,
  decodeControl,
  encodeAwarenessMessage,
  encodeControl,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
  MESSAGE_TYPE,
  updateHasNewContent,
} from "../../../apps/api/src/page/collab/protocol";

function docWith(text: string) {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return doc;
}

describe("page socket codec", () => {
  it("round-trips sync step 1, step 2 and updates", () => {
    const doc = docWith("hello");
    const step1 = decodeClientMessage(encodeSyncStep1(doc));
    expect(step1).toEqual({
      type: "sync-step1",
      stateVector: Y.encodeStateVector(doc),
    });

    const step2 = decodeClientMessage(encodeSyncStep2(doc));
    if (step2.type !== "sync-step2") throw new Error(step2.type);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, step2.update);
    expect(copy.getText("t").toString()).toBe("hello");

    const update = Y.encodeStateAsUpdate(doc);
    expect(decodeClientMessage(encodeSyncUpdate(update))).toEqual({
      type: "sync-update",
      update,
    });
  });

  it("round-trips awareness, query awareness and auth", () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState({ user: { id: "u1", color: "blue" } });
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [
      doc.clientID,
    ]);
    expect(decodeClientMessage(encodeAwarenessMessage(update))).toEqual({
      type: "awareness",
      update,
    });
    expect(decodeClientMessage(encodeQueryAwareness())).toEqual({
      type: "query-awareness",
    });
    expect(decodeClientMessage(new Uint8Array([MESSAGE_TYPE.auth, 0]))).toEqual(
      { type: "auth" },
    );
    awareness.destroy();
  });

  it("reports other types as unsupported and throws on malformed frames", () => {
    expect(
      decodeClientMessage(encodeControl({ kind: "save-error" })),
    ).toMatchObject({ type: "unsupported", messageType: MESSAGE_TYPE.control });
    expect(() => decodeClientMessage(new Uint8Array([0, 9, 0]))).toThrow();
    expect(() => decodeClientMessage(new Uint8Array([0xff, 0xff]))).toThrow();
  });

  it("encodes control messages as type 100 with a JSON varstring", () => {
    const message = {
      kind: "saved",
      at: "2026-10-06T00:00:00.000Z",
      contentVersion: 4,
    } as const;
    const frame = encodeControl(message);
    expect(frame[0]).toBe(MESSAGE_TYPE.control);
    expect(decodeControl(frame)).toEqual(message);
    expect(decodeControl(encodeQueryAwareness())).toBeNull();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_TYPE.control);
    encoding.writeVarString(
      encoder,
      JSON.stringify({ kind: "too-large", limitBytes: 1 }),
    );
    expect(decodeControl(encoding.toUint8Array(encoder))).toEqual({
      kind: "too-large",
      limitBytes: 1,
    });
  });
});

describe("updateHasNewContent", () => {
  it("detects items the doc lacks, through a diff update", () => {
    const server = docWith("shared");
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    // Nothing new: the client's step 2 against the server's state vector.
    expect(
      updateHasNewContent(
        server,
        Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)),
      ),
    ).toBe(false);

    client.getText("t").insert(6, " offline");
    expect(
      updateHasNewContent(
        server,
        Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)),
      ),
    ).toBe(true);
  });

  it("detects deletions the doc does not have, and ignores ones it has", () => {
    const server = docWith("abcdef");
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    server.getText("t").delete(0, 1);
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    // The client's step 2 carries its whole delete set, all known here.
    expect(
      updateHasNewContent(
        server,
        Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)),
      ),
    ).toBe(false);

    client.getText("t").delete(2, 2);
    expect(
      updateHasNewContent(
        server,
        Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)),
      ),
    ).toBe(true);
  });
});
