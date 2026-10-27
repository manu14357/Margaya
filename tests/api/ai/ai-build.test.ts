import { describe, expect, it } from "vitest";
import { sampleForSchema } from "../../../apps/api/src/ai/provider/fake";
import {
  buildStepCount,
  closestPoint,
} from "../../../apps/api/src/ai-build/apply";
import { rankDuplicateVerdicts } from "../../../apps/api/src/ai-build/duplicates";
import {
  BUILD_JSON_SCHEMA,
  normalizeProposal,
  projectKeyFrom,
} from "../../../apps/api/src/ai-build/proposal";
import { buildProposalSchema } from "../../../apps/api/src/ai-build/schema";
import { sharedTitleWords } from "../../../apps/api/src/task/similar-tasks";

describe("normalizeProposal", () => {
  it("keeps a valid plan and fixes what the model got wrong", () => {
    const proposal = normalizeProposal(
      {
        summary: "Relaunch the site in three sprints.",
        project: { name: "Website relaunch", key: "web re!", description: "" },
        columns: [{ name: "QA" }, { name: "qa" }, { name: "" }],
        labels: [
          { name: "Design", color: "purple" },
          { name: "Ops", color: "neon" },
        ],
        cycles: [
          {
            ref: "c1",
            name: "Sprint 1",
            description: "",
            startDate: "2026-10-01",
            endDate: "2026-10-14",
          },
          {
            ref: "c1",
            name: "Sprint 2",
            description: "",
            startDate: "2026-10-20",
            endDate: "2026-10-15",
          },
        ],
        modules: [{ ref: "m1", name: "Content", description: "Copy" }],
        tasks: [
          {
            title: "Write copy",
            description: "All pages",
            priority: "critical",
            estimate: 3,
            column: null,
            labels: ["Design", "Content", "design"],
            cycleRef: "c1",
            moduleRef: "m9",
            subtasks: [{ title: "Home" }, { title: "" }],
          },
          { title: "  ", description: "", priority: "low" },
        ],
        extra: "ignored",
      },
      { newProject: true, fallbackName: "plan a relaunch" },
    );

    expect(buildProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal.project).toEqual({
      name: "Website relaunch",
      key: "WEBRE",
      description: "",
    });
    expect(proposal.columns).toEqual([{ name: "QA" }]);
    expect(proposal.labels).toEqual([
      { name: "Design", color: "purple" },
      { name: "Ops", color: "gray" },
      // Used by a task but missing from the list.
      { name: "Content", color: "gray" },
    ]);
    // Refs stay unique; a cycle ending before it starts becomes a draft.
    expect(proposal.cycles.map((cycle) => cycle.ref)).toEqual(["c1", "c2"]);
    expect(proposal.cycles[1]).toMatchObject({
      startDate: null,
      endDate: null,
    });
    expect(proposal.tasks).toHaveLength(1);
    expect(proposal.tasks[0]).toMatchObject({
      priority: "no-priority",
      estimate: 3,
      labels: ["Design", "Content"],
      cycleRef: "c1",
      moduleRef: null,
      subtasks: [{ title: "Home" }],
    });
  });

  it("drops the project when building into an existing one", () => {
    const proposal = normalizeProposal(
      { project: { name: "X", key: "X", description: "" } },
      { newProject: false, fallbackName: "" },
    );
    expect(proposal.project).toBeNull();
    expect(proposal.tasks).toEqual([]);
  });

  it("survives the fake provider's minimal answer", () => {
    const proposal = normalizeProposal(sampleForSchema(BUILD_JSON_SCHEMA), {
      newProject: true,
      fallbackName: "Mobile app",
    });
    expect(buildProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal.project?.key).toBe("FAKE");
  });
});

describe("projectKeyFrom", () => {
  it("uses initials, or the start of a single word", () => {
    expect(projectKeyFrom("Website relaunch Q4")).toBe("WRQ");
    expect(projectKeyFrom("Marketing")).toBe("MARKE");
    expect(projectKeyFrom("Новый сайт")).toBe("НС");
    expect(projectKeyFrom("")).toBe("NEW");
  });
});

describe("closestPoint", () => {
  it("picks the nearest numeric point, the lower one on ties", () => {
    const points = [
      { id: "p1", numericValue: 1 },
      { id: "p3", numericValue: 3 },
      { id: "px", numericValue: null },
    ];
    expect(closestPoint(points, 2)).toBe("p1");
    expect(closestPoint(points, 13)).toBe("p3");
    expect(closestPoint([{ id: "c", numericValue: null }], 5)).toBeNull();
  });
});

describe("buildStepCount", () => {
  it("counts the project, columns, cycles, modules, tasks and sub-tasks", () => {
    const proposal = normalizeProposal(
      {
        columns: [{ name: "QA" }],
        cycles: [{ ref: "c1", name: "S1" }],
        modules: [],
        tasks: [
          { title: "A", subtasks: [{ title: "a1" }, { title: "a2" }] },
          { title: "B" },
        ],
      },
      { newProject: true, fallbackName: "Plan" },
    );
    expect(buildStepCount(proposal, true)).toBe(1 + 1 + 1 + 0 + 2 + 2);
    expect(buildStepCount(proposal, false)).toBe(6);
  });
});

describe("rankDuplicateVerdicts", () => {
  const candidates = [
    { id: "1", key: "WEB-1", title: "Login broken" },
    { id: "2", key: "WEB-2", title: "Login slow" },
    { id: "3", key: "WEB-3", title: "Pricing" },
  ];

  it("keeps duplicates first, then related; drops different and unknown keys", () => {
    const ranked = rankDuplicateVerdicts(candidates, {
      matches: [
        { key: "WEB-2", verdict: "related", reason: "same page" },
        { key: "web-1", verdict: "duplicate", reason: "same bug" },
        { key: "WEB-3", verdict: "different", reason: "" },
        { key: "WEB-9", verdict: "duplicate", reason: "invented" },
        { key: "WEB-1", verdict: "related", reason: "repeat" },
      ],
    });
    expect(ranked.map((task) => [task.key, task.verdict, task.reason])).toEqual(
      [
        ["WEB-1", "duplicate", "same bug"],
        ["WEB-2", "related", "same page"],
      ],
    );
  });

  it("answers nothing for a malformed answer", () => {
    expect(rankDuplicateVerdicts(candidates, null)).toEqual([]);
    expect(rankDuplicateVerdicts(candidates, { matches: "x" })).toEqual([]);
  });
});

describe("sharedTitleWords", () => {
  it("counts draft words found as title words or word starts", () => {
    expect(
      sharedTitleWords(
        ["login", "safari", "broken"],
        "Login page breaks on Safari",
      ),
    ).toBe(2);
    expect(sharedTitleWords(["log"], "Login")).toBe(1);
    expect(sharedTitleWords(["gin"], "Login")).toBe(0);
  });
});
