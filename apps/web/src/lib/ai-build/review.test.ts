import { describe, expect, it } from "vitest";
import type { BuildProposal } from "@/fetchers/ai/build";
import {
  canCreate,
  countItems,
  moveTask,
  toProposal,
  toReview,
} from "./review";

const project = { name: "Relaunch", key: "RL", description: "Q4" };

const proposal: BuildProposal = {
  summary: "Two sprints.",
  project,
  columns: [{ name: "QA" }],
  labels: [
    { name: "Design", color: "purple" },
    { name: "Ops", color: "gray" },
  ],
  cycles: [
    {
      ref: "c1",
      name: "Sprint 1",
      description: "",
      startDate: "2026-11-02",
      endDate: "2026-11-13",
    },
  ],
  modules: [{ ref: "m1", name: "Content", description: "" }],
  tasks: [
    {
      title: "Audit",
      description: "",
      priority: "high",
      estimate: 3,
      column: "QA",
      labels: ["Design", "Ops"],
      cycleRef: "c1",
      moduleRef: "m1",
      subtasks: [{ title: "Export" }, { title: "Tag" }],
    },
    {
      title: "Ship",
      description: "",
      priority: "urgent",
      estimate: null,
      column: null,
      labels: [],
      cycleRef: null,
      moduleRef: null,
      subtasks: [],
    },
  ],
};

function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`No item at index ${index}`);
  return item;
}

describe("review", () => {
  it("round-trips an untouched proposal", () => {
    expect(toProposal(toReview(proposal))).toEqual(proposal);
    expect(countItems(proposal)).toBe(1 + 1 + 1 + 1 + 2 + 2);
  });

  it("leaves out what was unchecked and clears references to it", () => {
    const draft = toReview(proposal);
    draft.columns[0] = { ...at(draft.columns, 0), include: false };
    draft.labels[1] = { ...at(draft.labels, 1), include: false };
    draft.cycles[0] = { ...at(draft.cycles, 0), include: false };
    draft.modules[0] = { ...at(draft.modules, 0), include: false };
    draft.tasks[1] = { ...at(draft.tasks, 1), include: false };
    const first = at(draft.tasks, 0);
    draft.tasks[0] = {
      ...first,
      title: "  Audit pages ",
      subtasks: [
        at(first.subtasks, 0),
        { ...at(first.subtasks, 1), include: false },
      ],
    };

    const result = toProposal(draft);
    expect(result.columns).toEqual([]);
    expect(result.labels).toEqual([{ name: "Design", color: "purple" }]);
    expect(result.cycles).toEqual([]);
    expect(result.modules).toEqual([]);
    expect(result.tasks).toEqual([
      {
        ...proposal.tasks[0],
        title: "Audit pages",
        column: null,
        labels: ["Design"],
        cycleRef: null,
        moduleRef: null,
        subtasks: [{ title: "Export" }],
      },
    ]);
    expect(countItems(result)).toBe(1 + 1 + 1);
  });

  it("turns a cycle with one date into a draft", () => {
    const draft = toReview(proposal);
    draft.cycles[0] = { ...at(draft.cycles, 0), endDate: null };
    expect(toProposal(draft).cycles[0]).toMatchObject({
      startDate: null,
      endDate: null,
    });
  });

  it("reorders tasks and ignores moves past the ends", () => {
    const { tasks } = toReview(proposal);
    expect(moveTask(tasks, 1, -1).map((task) => task.title)).toEqual([
      "Ship",
      "Audit",
    ]);
    expect(moveTask(tasks, 0, -1).map((task) => task.title)).toEqual([
      "Audit",
      "Ship",
    ]);
    expect(moveTask(tasks, 1, 1).map((task) => task.title)).toEqual([
      "Audit",
      "Ship",
    ]);
  });

  it("needs a project name and key, and something besides the project", () => {
    const draft = toReview(proposal);
    expect(canCreate(draft)).toBe(true);
    expect(canCreate({ ...draft, project: { ...project, key: " " } })).toBe(
      false,
    );
    expect(
      canCreate({
        ...draft,
        columns: [],
        cycles: [],
        modules: [],
        tasks: draft.tasks.map((task) => ({ ...task, include: false })),
      }),
    ).toBe(false);
  });
});
