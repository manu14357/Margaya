import { describe, expect, it } from "vitest";
import { linkCitations, unknownCitations } from "./brief-citations";

const citations = [
  { key: "WEB-12", url: "/dashboard/workspace/w/project/p/task/t12" },
  { key: "WEB-3", url: "/dashboard/workspace/w/project/p/task/t3" },
];

describe("linkCitations", () => {
  it("links cited keys and leaves unknown ones as text", () => {
    expect(
      linkCitations("Done: [WEB-12] and [WEB-3]; not [API-9].", citations),
    ).toBe(
      "Done: [WEB-12](/dashboard/workspace/w/project/p/task/t12) and [WEB-3](/dashboard/workspace/w/project/p/task/t3); not [API-9].",
    );
  });

  it("makes links absolute with a base and keeps existing links", () => {
    expect(linkCitations("[web-12]", citations, "https://m.example")).toBe(
      "[web-12](https://m.example/dashboard/workspace/w/project/p/task/t12)",
    );
    expect(linkCitations("[WEB-12](https://x)", citations)).toBe(
      "[WEB-12](https://x)",
    );
  });
});

describe("unknownCitations", () => {
  it("lists keys the facts never gave", () => {
    expect(unknownCitations("[WEB-12] [API-9] [API-9]", citations)).toEqual([
      "API-9",
    ]);
  });
});
