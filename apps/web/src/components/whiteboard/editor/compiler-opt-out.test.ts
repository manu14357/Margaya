import { describe, expect, it } from "vitest";

// The app is built with the React Compiler, which this test runner does not
// apply. Components that read the mutable board controller while rendering
// (undo state, collaborators, read-only) must opt out of its memoisation, or
// those reads freeze at their first value in the real app.

const sources = import.meta.glob<string>(["./*.tsx", "!./*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const READS_CONTROLLER =
  /\bc\.(history|remote|readOnly|state|options|scene|settings|copiedStyle)\b/;

describe("editor components and the React Compiler", () => {
  it("opt out of memoisation wherever they read the controller in render", () => {
    const missing = Object.entries(sources)
      .filter(([, source]) => READS_CONTROLLER.test(source))
      .filter(([, source]) => !/^(\/\/.*\n)*"use no memo";/m.test(source))
      .map(([file]) => file);
    expect(missing).toEqual([]);
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });
});
