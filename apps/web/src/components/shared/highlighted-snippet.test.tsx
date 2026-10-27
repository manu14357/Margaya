import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HighlightedSnippet } from "./highlighted-snippet";

afterEach(() => cleanup());

describe("HighlightedSnippet", () => {
  it("marks each highlighted range and keeps the rest as text", () => {
    const { container } = render(
      <HighlightedSnippet
        snippet={{
          text: "the rocket launch plan",
          highlights: [
            { start: 18, end: 22 },
            { start: 4, end: 10 },
          ],
        }}
      />,
    );
    expect(container.textContent).toBe("the rocket launch plan");
    expect(
      Array.from(container.querySelectorAll("mark")).map((m) => m.textContent),
    ).toEqual(["rocket", "plan"]);
  });

  it("renders markup in user text as text, never as HTML", () => {
    const { container } = render(
      <HighlightedSnippet
        snippet={{
          text: "<img src=x onerror=alert(1)> Привет",
          highlights: [{ start: 29, end: 35 }],
        }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("Привет");
  });

  it("drops ranges that are out of bounds or overlap", () => {
    const { container } = render(
      <HighlightedSnippet
        snippet={{
          text: "abcdef",
          highlights: [
            { start: 0, end: 3 },
            { start: 2, end: 4 },
            { start: 5, end: 99 },
            { start: 4, end: 4 },
          ],
        }}
      />,
    );
    expect(container.textContent).toBe("abcdef");
    expect(container.querySelectorAll("mark")).toHaveLength(1);
  });
});
