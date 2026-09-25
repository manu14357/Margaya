import { describe, expect, it } from "vitest";
import { matchesTerm, parsePaletteQuery } from "./palette-query";

describe("parsePaletteQuery", () => {
  it("reads each prefix as a mode", () => {
    expect(parsePaletteQuery("> new task")).toEqual({
      mode: "actions",
      term: "new task",
    });
    expect(parsePaletteQuery("#WEB-12")).toEqual({
      mode: "tasks",
      term: "WEB-12",
    });
    expect(parsePaletteQuery("@ana")).toEqual({ mode: "people", term: "ana" });
    expect(parsePaletteQuery("/inbox")).toEqual({
      mode: "places",
      term: "inbox",
    });
  });

  it("treats plain text as a search everywhere", () => {
    expect(parsePaletteQuery("  launch plan ")).toEqual({
      mode: "all",
      term: "launch plan",
    });
    expect(parsePaletteQuery("")).toEqual({ mode: "all", term: "" });
  });
});

describe("matchesTerm", () => {
  it("needs every word, in any of the texts, ignoring case", () => {
    expect(matchesTerm("web launch", "Website", "Launch plan")).toBe(true);
    expect(matchesTerm("web launch", "Website")).toBe(false);
    expect(matchesTerm("", "anything")).toBe(true);
    expect(matchesTerm("x", null, undefined)).toBe(false);
  });
});
