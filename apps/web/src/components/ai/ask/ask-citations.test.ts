import { describe, expect, it } from "vitest";
import type { AskSource } from "@/fetchers/ai/ask";
import { readAskSources } from "@/fetchers/ai/ask";
import {
  answerForCopy,
  CITE_HREF_PREFIX,
  citationLabel,
  citedSources,
  linkCitations,
  withoutInternalRefs,
} from "./ask-citations";

const task: AskSource = {
  ref: "T:WEB-12",
  kind: "task",
  id: "t1",
  title: "WEB-12 Fix login",
  url: "/dashboard/workspace/w1/project/p1/task/t1",
  projectId: "p1",
  updatedAt: null,
};
const page: AskSource = {
  ref: "P:Release plan",
  kind: "page",
  id: "pg1",
  title: "Release plan",
  url: "/dashboard/workspace/w1/project/p1/pages/pg1",
  projectId: "p1",
  updatedAt: null,
};
const comment: AskSource = {
  ref: "C:WEB-12/abc123",
  kind: "comment",
  id: "c1",
  title: "WEB-12 Fix login",
  url: "/dashboard/workspace/w1/project/p1/task/t1",
  projectId: "p1",
  updatedAt: null,
};
const sources = new Map([task, page, comment].map((s) => [s.ref, s]));

describe("Ask citations", () => {
  it("links known tokens and leaves invented ones as text", () => {
    const { markdown, cited } = linkCitations(
      "Dropped [C:WEB-12/abc123], see [P:Release plan] and [T:WEB-12] [T:WEB-12]. Fake: [T:NOPE-1]",
      sources,
    );
    expect(cited).toEqual([comment, page, task]);
    expect(markdown).toBe(
      `Dropped [WEB-12](${CITE_HREF_PREFIX}0), see [Release plan](${CITE_HREF_PREFIX}1) and [WEB-12](${CITE_HREF_PREFIX}2) [WEB-12](${CITE_HREF_PREFIX}2). Fake: [T:NOPE-1]`,
    );
    expect(citedSources("only [T:NOPE-1]", sources)).toEqual([]);
  });

  it("keeps punctuation right after a chip", () => {
    expect(
      linkCitations("Blocked by [T:WEB-12] , so [P:Release plan] .", sources)
        .markdown,
    ).toBe(
      `Blocked by [WEB-12](${CITE_HREF_PREFIX}0), so [Release plan](${CITE_HREF_PREFIX}1).`,
    );
    // Spaces before words, and around unknown tokens, are left alone.
    expect(
      linkCitations("See [T:WEB-12] and [T:NOPE-1] , ok", sources).markdown,
    ).toBe(`See [WEB-12](${CITE_HREF_PREFIX}0) and [T:NOPE-1] , ok`);
    expect(
      answerForCopy("Fixed [T:WEB-12] .", sources, "x", "Sources"),
    ).toMatch(/^Fixed \[WEB-12\]\./);
  });

  it("labels chips by key, title or the comment's task", () => {
    expect(citationLabel(task)).toBe("WEB-12");
    expect(citationLabel(comment)).toBe("WEB-12");
    expect(citationLabel({ ...page, ref: `P:${"x".repeat(40)}` })).toHaveLength(
      32,
    );
  });

  it("copies plain labels plus full links", () => {
    expect(
      answerForCopy(
        "Fixed [T:WEB-12].",
        sources,
        "https://pm.example",
        "Sources",
      ),
    ).toBe(
      "Fixed [WEB-12].\n\nSources:\n- WEB-12 Fix login: https://pm.example/dashboard/workspace/w1/project/p1/task/t1",
    );
    expect(answerForCopy("No sources.", sources, "x", "Sources")).toBe(
      "No sources.",
    );
  });

  it("only accepts in-app source links", () => {
    expect(
      readAskSources([
        task,
        { ...page, url: "https://evil.example/x" },
        { ...comment, kind: "other" },
        "nope",
      ]),
    ).toEqual([task]);
    expect(readAskSources(undefined)).toEqual([]);
  });
});

describe("internal references", () => {
  it("drops facts and memory refs and names attachments", () => {
    expect(
      withoutInternalRefs(
        "There is 1 task [facts:counts Website Relaunch]. Release is Thursday [memory:notes]. Priya owns QA [file:notes.txt].",
      ),
    ).toBe("There is 1 task. Release is Thursday. Priya owns QA (notes.txt).");
  });

  it("keeps real citations linkable", () => {
    const sources = new Map([[task.ref, task]]);
    const { markdown } = linkCitations(
      "WEB-12 is late [T:WEB-12] [facts:counts WEB].",
      sources,
    );
    expect(markdown).toBe(`WEB-12 is late [WEB-12](${CITE_HREF_PREFIX}0).`);
  });
});
