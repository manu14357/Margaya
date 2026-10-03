import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  jsonToMarkdown,
  markdownToJson,
  type PageDocument,
  pageSchema,
} from "@margaya/editor-schema";
import { Editor, getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { afterEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createPageEditorExtensions } from "./page-editor-extensions";

// The headless package's fixtures: the same document, rendered by the
// server's serializer, must come out of the web editor byte for byte.
const FIXTURES = join(
  import.meta.dirname,
  "../../../../../../packages/editor-schema/test/fixtures",
);

function fixtureDocument(): PageDocument {
  return JSON.parse(
    readFileSync(join(FIXTURES, "custom-nodes.json"), "utf8"),
  ) as PageDocument;
}

function webExtensions(withCollaboration: boolean) {
  const doc = new Y.Doc();
  return createPageEditorExtensions({
    placeholder: "",
    workspaceId: "w1",
    projectId: "p1",
    getMembers: () => [],
    getHighlighter: () => null,
    toShikiLanguage: (language) => language,
    collaboration: withCollaboration
      ? {
          doc,
          provider: { awareness: new Awareness(doc) },
          user: { id: "u1", color: "blue" },
          resolveName: () => "",
        }
      : undefined,
  });
}

function describeSchema(schema: Schema) {
  const nodes = Object.fromEntries(
    Object.entries(schema.nodes).map(([name, type]) => [
      name,
      Object.keys(type.spec.attrs ?? {}).sort(),
    ]),
  );
  const marks = Object.fromEntries(
    Object.entries(schema.marks).map(([name, type]) => [
      name,
      Object.keys(type.spec.attrs ?? {}).sort(),
    ]),
  );
  return { nodes, marks };
}

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("page editor schema", () => {
  it.each([[false], [true]])(
    "matches the headless schema (collaboration: %s)",
    (withCollaboration) => {
      const web = describeSchema(getSchema(webExtensions(withCollaboration)));
      const headless = describeSchema(pageSchema());
      expect(Object.keys(web.nodes).sort()).toEqual(
        Object.keys(headless.nodes).sort(),
      );
      expect(web.nodes).toEqual(headless.nodes);
      expect(web.marks).toEqual(headless.marks);
    },
  );

  it("shares exactly { id, color } as the awareness user", () => {
    const caret = webExtensions(true).find(
      (extension) => extension.name === "collaborationCaret",
    );
    // The page socket drops awareness with any other user field.
    expect(caret?.options.user).toEqual({ id: "u1", color: "blue" });
  });

  it("writes the fixture document as the server's serializer does", () => {
    const document = fixtureDocument();
    editor = new Editor({
      extensions: webExtensions(false),
      content: document,
    });
    expect(editor.getMarkdown()).toBe(jsonToMarkdown(document));
  });

  it("writes and reads callouts and sized images as the server does", () => {
    const markdown = [
      "> [!WARNING]",
      "> Careful",
      ">",
      "> - one",
      "",
      '<img src="https://x.test/a.png" alt="A" width="50%" data-align="center" />',
      "",
      "![B](https://x.test/b.png)",
      "",
      "> plain quote",
    ].join("\n");
    const document = markdownToJson(markdown);
    expect(document.content?.map((node) => node.type)).toEqual([
      "callout",
      "image",
      "image",
      "blockquote",
    ]);
    editor = new Editor({
      extensions: webExtensions(false),
      content: document,
    });
    expect(editor.getMarkdown()).toBe(jsonToMarkdown(document));
    expect(editor.getMarkdown()).toBe(markdown);

    editor.commands.setContent(markdown, { contentType: "markdown" });
    expect(editor.getJSON()).toEqual(document);
  });

  it("writes page links exactly as the headless node does", () => {
    const document: PageDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "margayaPageLink",
              attrs: { pageId: "pg_1", title: 'Q&A "notes" <v2>' },
            },
          ],
        },
      ],
    };
    editor = new Editor({
      extensions: webExtensions(false),
      content: document,
    });
    const markdown = editor.getMarkdown();
    expect(markdown).toBe(jsonToMarkdown(document));
    expect(markdown).toContain(
      '<margaya-page-link id="pg_1" title="Q&amp;A &quot;notes&quot; &lt;v2&gt;"></margaya-page-link>',
    );
  });
});
