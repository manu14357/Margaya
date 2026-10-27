import { describe, expect, it } from "vitest";
import type { TriageCandidates } from "../../../apps/api/src/ai-triage/candidates";
import {
  groundedReason,
  parseTriageOutput,
  refTables,
  resolveSuggestions,
} from "../../../apps/api/src/ai-triage/suggest";

const task = {
  id: "t6",
  projectId: "web",
  key: "WEB-6",
  title: "Checkout times out",
  description: "",
  priority: "no-priority",
  labelNames: [],
  assigneeIds: [],
  isIntake: false,
};

const candidates: TriageCandidates = {
  labels: [{ id: "l1", name: "bug", color: "#000" }],
  people: [
    { id: "mia", name: "Mia", image: null },
    { id: "owen", name: "Owen", image: null },
  ],
  projects: [{ id: "web", name: "Web", slug: "web" }],
  similar: [
    {
      id: "t3",
      projectId: "web",
      key: "WEB-3",
      title: "Checkout slow",
      status: "done",
      labelNames: ["bug"],
      assigneeIds: ["mia"],
      score: 1,
      titleMatch: false,
    },
  ],
};

function resolve(output: unknown) {
  return resolveSuggestions(
    task,
    parseTriageOutput(output),
    candidates,
    refTables(candidates),
  );
}

const empty = {
  labels: [],
  assignee: [],
  priority: [],
  project: [],
  duplicates: [],
};

describe("triage grounding", () => {
  it("keeps an assignee who handled a similar task", () => {
    const result = resolve({
      ...empty,
      assignee: [{ ref: "P1", reason: "Handled similar task WEB-3" }],
    });
    expect(result.assignee).toEqual({
      person: candidates.people[0],
      reason: "Handled similar task WEB-3",
    });
  });

  it("drops an assignee with no work evidence in the data", () => {
    const result = resolve({
      ...empty,
      assignee: [{ ref: "P2", reason: "Reported the task in review" }],
    });
    expect(result.assignee).toBeNull();
  });

  it("drops an assignee whose reason cites a task the model never saw", () => {
    const result = resolve({
      ...empty,
      assignee: [{ ref: "P1", reason: "Fixed WEB-99 last week" }],
    });
    expect(result.assignee).toBeNull();
  });

  it("drops reasons that cite unknown tasks of known projects", () => {
    const known = new Set(["WEB-3", "WEB-6"]);
    const prefixes = new Set(["WEB"]);
    expect(groundedReason("Like WEB-3", known, prefixes)).toBe("Like WEB-3");
    expect(groundedReason("Like WEB-42", known, prefixes)).toBeNull();
    expect(groundedReason("Breaks UTF-8 input", known, prefixes)).toBe(
      "Breaks UTF-8 input",
    );
    expect(groundedReason("", known, prefixes)).toBeNull();

    const result = resolve({
      ...empty,
      labels: [{ ref: "L1", reason: "WEB-77 carries it" }],
    });
    expect(result.labels).toEqual([
      { label: candidates.labels[0], reason: null },
    ]);
  });
});
