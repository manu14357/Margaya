import { describe, expect, it } from "vitest";
import { compactDateKind, splitForMiddleTruncation } from "./middle-truncate";

describe("splitForMiddleTruncation", () => {
  it("keeps a short email domain whole", () => {
    expect(
      splitForMiddleTruncation("alexandria.featherstonehaugh@example.org"),
    ).toEqual({ head: "alexandria.featherstonehaugh", tail: "@example.org" });
  });

  it("keeps the last two labels of a long domain, never a cut word", () => {
    const email = "max@operations.research.international-holdings.example.net";
    const { head, tail } = splitForMiddleTruncation(email);
    expect(head + tail).toBe(email);
    expect(tail).toBe("example.net");
  });

  it("keeps an @domain of up to 32 characters whole", () => {
    // "@research-division.example.com" is 30 characters.
    expect(
      splitForMiddleTruncation("a.person@research-division.example.com"),
    ).toEqual({ head: "a.person", tail: "@research-division.example.com" });
  });

  it("falls back to the last two labels past 32 characters", () => {
    const email =
      "constantina.oyelaran.kowalczyk@very-long-subsidiary-name.example.com";
    const { head, tail } = splitForMiddleTruncation(email);
    expect(tail).toBe("example.com");
    expect(head + tail).toBe(email);
  });

  it("keeps the end of an id", () => {
    expect(splitForMiddleTruncation("whk_01JABCDEFGHJKMNPQRST")).toEqual({
      head: "whk_01JABCDEFGHJ",
      tail: "KMNPQRST",
    });
  });

  it("does not split short text", () => {
    expect(splitForMiddleTruncation("short-id")).toEqual({
      head: "short-id",
      tail: "",
    });
  });
});

describe("compactDateKind", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("is relative within a week", () => {
    expect(compactDateKind(new Date("2026-11-12T08:00:00Z"), now)).toBe(
      "relative",
    );
  });

  it("is a short date earlier this year", () => {
    expect(compactDateKind(new Date("2026-03-02T08:00:00Z"), now)).toBe(
      "short",
    );
  });

  it("names the year for older dates", () => {
    expect(compactDateKind(new Date("2025-03-02T08:00:00Z"), now)).toBe(
      "medium",
    );
  });
});
