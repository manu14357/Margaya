import { describe, expect, it } from "vitest";
import type { TriageCandidates } from "../../../apps/api/src/ai-triage/candidates";
import {
  groundedReason,
  namedReason,
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

describe("triage reasons in words", () => {
  it("names the person, label or project behind a prompt reference", () => {
    const tables = refTables(candidates);
    expect(
      namedReason("P1 is listed as assignee on similar task WEB-3", tables),
    ).toBe("Mia is listed as assignee on similar task WEB-3");
    expect(namedReason("Similar tasks carry L1 (R1)", tables)).toBe(
      "Similar tasks carry bug (Web)",
    );
    // Unknown references and look-alikes stay as written.
    expect(namedReason("P9 and MP3 and P1-2", tables)).toBe(
      "P9 and MP3 and P1-2",
    );
  });

  it("never shows a candidate reference in a suggestion", () => {
    const result = resolve({
      ...empty,
      assignee: [
        { ref: "P1", reason: "P1 is the assignee of similar task WEB-3" },
      ],
      labels: [{ ref: "L1", reason: "WEB-3 carries L1" }],
    });
    expect(result.assignee?.reason).toBe(
      "Mia is the assignee of similar task WEB-3",
    );
    expect(result.labels[0]?.reason).toBe("WEB-3 carries bug");
  });
});
