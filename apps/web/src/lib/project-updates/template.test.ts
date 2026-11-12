import { describe, expect, it } from "vitest";
import { buildTemplateDraft, type TemplateFacts } from "./template";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const empty = { total: 0, tasks: [] };

function facts(overrides: Partial<TemplateFacts> = {}): TemplateFacts {
  return {
    sinceLastUpdate: true,
    counts: { total: 10, open: 6, completed: 4, percent: 40 },
    completed: { total: 1, tasks: [{ key: "WEB-1", title: "Ship login" }] },
    moved: { total: 3 },
    overdue: empty,
    blocked: empty,
    inProgress: { total: 1, tasks: [{ key: "WEB-2", title: "Docs" }] },
    cycles: [],
    forecastP85: null,
    suggestedHealth: "on_track",
    ...overrides,
  };
}

describe("buildTemplateDraft", () => {
  it("takes the suggested health and lists tasks by key", () => {
    const draft = buildTemplateDraft(facts(), t);
    expect(draft.health).toBe("on_track");
    expect(draft.highlights).toBe("- [WEB-1] Ship login");
    expect(draft.nextSteps).toBe("- [WEB-2] Docs");
    expect(draft.blockers).toBe("");
    expect(draft.summary).toContain(
      "projectUpdates:template.changesSinceUpdate",
    );
    expect(draft.summary).not.toContain("template.forecast");
  });

  it("says how many more tasks a list holds than it shows", () => {
    const draft = buildTemplateDraft(
      facts({
        overdue: { total: 3, tasks: [{ key: "WEB-3", title: "Late" }] },
        suggestedHealth: "at_risk",
      }),
      t,
    );
    expect(draft.blockers).toContain(
      'projectUpdates:template.overdue {"count":3}',
    );
    expect(draft.blockers).toContain("- [WEB-3] Late");
    expect(draft.blockers).toContain(
      'projectUpdates:template.more {"count":2}',
    );
    expect(draft.health).toBe("at_risk");
  });

  it("adds cycles, the forecast and the 7-day window without an earlier update", () => {
    const draft = buildTemplateDraft(
      facts({
        sinceLastUpdate: false,
        forecastP85: "2026-12-01",
        cycles: [
          {
            name: "Sprint 4",
            endDate: "2026-11-20",
            total: 8,
            completed: 2,
            percent: 25,
          },
        ],
      }),
      t,
    );
    expect(draft.summary).toContain("projectUpdates:template.changesLastWeek");
    expect(draft.summary).toContain("2026-12-01");
    expect(draft.highlights).toContain("Sprint 4");
  });
});
