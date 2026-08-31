import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyJsonToYDoc,
  jsonToYDoc,
  jsonToYjsState,
  markdownToJson,
  PAGE_FRAGMENT,
  yDocToJson,
  yjsStateToJson,
} from "../src/index";

const SOURCE = markdownToJson(
  [
    "# Plan",
    "First paragraph with **bold** text.",
    "- [ ] task one\n- [x] task two",
    'Ping <margaya-mention id="u1" label="Ann"></margaya-mention> about <margaya-page-link id="p2" title="Specs"></margaya-page-link>',
    "Last paragraph.",
  ].join("\n\n"),
);

const TARGET = markdownToJson(
  [
    "# Plan v2",
    "First paragraph with *italic* text.",
    "- [x] task one\n- [x] task two\n- [ ] task three",
    "Last paragraph.",
    "```mermaid\ngraph TD\n```",
  ].join("\n\n"),
);

function textOfParagraph(doc: Y.Doc, index: number): string {
  const json = yDocToJson(doc);
  return (json.content?.[index]?.content ?? [])
    .map((node) => node.text ?? "")
    .join("");
}

describe("Yjs conversions", () => {
  it("JSON into a new doc and back is the identity", () => {
    const doc = jsonToYDoc(SOURCE);
    expect(yDocToJson(doc)).toEqual(SOURCE);
    expect(yjsStateToJson(jsonToYjsState(SOURCE))).toEqual(SOURCE);
    expect(doc.share.has(PAGE_FRAGMENT)).toBe(true);
  });

  it("turns a different document into exactly the target", () => {
    const doc = jsonToYDoc(SOURCE);
    applyJsonToYDoc(doc, TARGET);
    expect(yDocToJson(doc)).toEqual(TARGET);

    // And back again, from the diffed state.
    applyJsonToYDoc(doc, SOURCE);
    expect(yDocToJson(doc)).toEqual(SOURCE);
  });

  it("fills an empty doc and tags the transaction with the origin", () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });
    applyJsonToYDoc(doc, TARGET, "server");
    expect(yDocToJson(doc)).toEqual(TARGET);
    expect(origins).toEqual(["server"]);
  });

  it("changes nothing when the doc already holds the target", () => {
    const doc = jsonToYDoc(TARGET);
    const before = Y.encodeStateVector(doc);
    applyJsonToYDoc(doc, TARGET);
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });

  it("keeps a concurrent remote edit merged after a replace", () => {
    const server = jsonToYDoc(SOURCE);
    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));

    // The client types into the last paragraph while the server replaces.
    const clientUpdates: Uint8Array[] = [];
    client.on("update", (update: Uint8Array) => clientUpdates.push(update));
    const last = client.getXmlFragment(PAGE_FRAGMENT).get(4) as Y.XmlElement;
    (last.get(0) as Y.XmlText).insert(0, "Edited: ");

    const replaced = markdownToJson(
      [
        "# Plan v2",
        "First paragraph with **bold** text.",
        "- [ ] task one\n- [x] task two",
        'Ping <margaya-mention id="u1" label="Ann"></margaya-mention> about <margaya-page-link id="p2" title="Specs"></margaya-page-link>',
        "Last paragraph.",
      ].join("\n\n"),
    );
    applyJsonToYDoc(server, replaced, "server");
    for (const update of clientUpdates) Y.applyUpdate(server, update);

    const merged = yDocToJson(server);
    expect(merged.content?.[0]?.content?.[0]?.text).toBe("Plan v2");
    expect(textOfParagraph(server, 4)).toBe("Edited: Last paragraph.");

    // Both sides converge.
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    expect(yDocToJson(client)).toEqual(merged);
  });
});
