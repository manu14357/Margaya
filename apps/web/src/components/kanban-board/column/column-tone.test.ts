import { describe, expect, it } from "vitest";
import { columnTones } from "./column-tone";

const column = (slug: string, group: string) => ({ id: slug, slug, group });

describe("columnTones", () => {
  it("colours each column by its group", () => {
    const tones = columnTones([
      column("backlog", "backlog"),
      column("to-do", "unstarted"),
      column("done", "completed"),
      column("wont-do", "cancelled"),
    ]);

    expect([...tones.values()].map((tone) => tone.name)).toEqual([
      "backlog",
      "unstarted",
      "completed",
      "cancelled",
    ]);
    expect(tones.get("to-do")?.style).toEqual({
      "--col": "var(--status-unstarted)",
    });
  });

  it("gives the second and later started columns the review hue", () => {
    const tones = columnTones([
      column("in-progress", "started"),
      column("in-review", "started"),
      column("qa", "started"),
    ]);

    expect(tones.get("in-progress")?.name).toBe("started");
    expect(tones.get("in-review")?.name).toBe("review");
    expect(tones.get("qa")?.name).toBe("review");
  });

  it("prefers the column's own colour and ignores unusable values", () => {
    const tones = columnTones(
      [column("to-do", "unstarted"), column("doing", "started")],
      new Map([
        ["to-do", "#0ea5e9"],
        ["doing", "not a colour"],
      ]),
    );

    expect(tones.get("to-do")?.name).toBe("custom");
    expect(tones.get("to-do")?.style).toMatchObject({ "--col": "#0ea5e9" });
    expect(tones.get("doing")?.name).toBe("started");
  });

  it("falls back to isFinal for columns cached before groups", () => {
    const tones = columnTones([
      { id: "a", slug: "a", isFinal: true },
      { id: "b", slug: "b", isFinal: false },
    ]);

    expect(tones.get("a")?.name).toBe("completed");
    expect(tones.get("b")?.name).toBe("unstarted");
  });
});
