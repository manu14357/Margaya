import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { RetroFacts } from "@/fetchers/insight/insight";
import { retroFactLines, retroMarkdown } from "./retro-markdown";

const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction;

const list = (keys: string[]) => ({
  total: keys.length,
  tasks: keys.map((key) => ({
    id: key,
    key,
    title: `T ${key}`,
    projectId: "p",
  })),
});

const facts = {
  cycle: {
    id: "c",
    name: "Sprint 7",
    projectId: "p",
    startDate: "2026-10-01",
    endDate: "2026-10-14",
    status: "completed",
  },
  generatedAt: "2026-10-15T00:00:00.000Z",
  counts: {
    committed: 4,
    completed: 2,
    committedCompleted: 1,
    added: 1,
    removed: 1,
    carriedOver: 1,
    leftOpen: 1,
    reopened: 0,
    blocked: 0,
  },
  sayDoPercent: 25,
  points: null,
  added: list(["WEB-2"]),
  removed: list(["WEB-5"]),
  carriedOver: list(["WEB-4"]),
  leftOpen: list(["WEB-3"]),
  reopened: list([]),
  cycleTime: {
    samples: 2,
    medianDays: 1.5,
    projectP85Days: null,
    threshold: null,
    thresholdKind: null,
    outliers: [],
  },
  blocked: [],
  forecast: {
    p85: null,
    madeAt: null,
    finishedOn: null,
    endDate: "2026-10-14",
    met: null,
  },
} as RetroFacts;

describe("retro markdown", () => {
  it("states every computed fact, numbers from the API", () => {
    const lines = retroFactLines(facts, t);
    expect(lines[0]).toBe(
      'insight:retro.facts.sayDo:{"done":1,"count":4,"percent":25}',
    );
    expect(lines).toContain('insight:retro.facts.cycleTime:{"median":1.5}');
    expect(lines.at(-1)).toBe("insight:retro.facts.forecastNone");
  });

  it("states committed points, but not when no points were committed", () => {
    const pointLine = (committed: number) =>
      retroFactLines({ ...facts, points: { committed, completed: 7 } }, t).find(
        (line) => line.startsWith("insight:retro.facts.points"),
      );
    expect(pointLine(24)).toBe(
      'insight:retro.facts.points:{"completed":7,"committed":24}',
    );
    expect(pointLine(0)).toBeUndefined();
  });

  it("builds a page with facts, lists, the narrative and team sections", () => {
    const page = retroMarkdown(facts, t, "## Summary\nScope grew [WEB-2].");
    expect(page).toContain("## insight:retro.page.facts");
    expect(page).toContain("- WEB-4 T WEB-4");
    expect(page).toContain("Scope grew [WEB-2].");
    expect(page.indexOf("## insight:retro.page.wentWell")).toBeGreaterThan(
      page.indexOf("Scope grew"),
    );
    // Without a narrative the sections still follow the facts.
    expect(retroMarkdown(facts, t)).not.toContain("Summary");
  });
});
