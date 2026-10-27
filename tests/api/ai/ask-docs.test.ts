import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  docsItems,
  resetDocsIndex,
  searchDocs,
} from "../../../apps/api/src/ai-ask/docs";

// The real guides in apps/docs/core: Ask answers "how do I…" from them.
const DOCS = path.resolve(__dirname, "../../../apps/docs/core");

beforeEach(() => {
  process.env.MARGAYA_DOCS_DIR = DOCS;
  resetDocsIndex();
});

afterEach(() => {
  delete process.env.MARGAYA_DOCS_DIR;
  resetDocsIndex();
});

describe("Ask documentation", () => {
  it("finds the guide for a how-to question and cites it as D:n", () => {
    const items = docsItems("How do I turn on AI for a workspace?");
    expect(items[0]).toMatchObject({
      kind: "web",
      ref: "D:1",
      dataTier: "public",
      url: "https://margaya.app/docs/core/functional/ai-setup",
    });
    expect(items[0]?.text).toContain("Margaya documentation: AI Setup");
    // The last item lists the guides, so "what's documented?" is answerable.
    expect(items.at(-1)?.text).toContain("Repeating Tasks");
  });

  it("matches the guides' own words: recurring finds Repeating Tasks", () => {
    expect(searchDocs("how do recurring tasks work")[0]?.page).toBe(
      "core/functional/repeating-tasks",
    );
  });

  it("answers a question about the docs with the list of guides only", () => {
    const items = docsItems("do you have access of docs? of margaya?");
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Margaya docs");
  });

  it("stays out of questions about the team's work", () => {
    expect(docsItems("What is blocking the current cycle?")).toEqual([]);
  });

  it("has no docs when the folder is missing", () => {
    process.env.MARGAYA_DOCS_DIR = path.join(DOCS, "missing");
    resetDocsIndex();
    expect(docsItems("how do I turn on AI")).toEqual([]);
  });
});
