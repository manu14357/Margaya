import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT } from "../../../apps/api/src/task-draft/normalize";
import {
  buildPublishPlan,
  type PublishFacts,
} from "../../../apps/api/src/task-draft/publish-plan";

const facts: PublishFacts = {
  today: "2026-06-15",
  columns: [
    { slug: "backlog", position: 0, group: "backlog" },
    { slug: "to-do", position: 1, group: "unstarted" },
    { slug: "doing", position: 2, group: "started" },
    { slug: "done", position: 3, group: "completed" },
  ],
  assignableIds: new Set(["u1", "u2"]),
  fieldIds: new Set(["f1"]),
  features: { cycles: true, modules: true, estimates: true },
  cycle: { archivedAt: null, startDate: "2026-06-01", endDate: "2026-06-30" },
  activeModuleIds: new Set(["m1", "m2"]),
  pointActive: true,
};

const draft = {
  ...EMPTY_DRAFT,
  projectId: "p1",
  title: "Publish me",
  status: "doing",
  assigneeIds: ["u1", "u2"],
  customFieldValues: [{ fieldId: "f1", value: "x" }],
  cycleId: "c1",
  moduleIds: ["m1", "m2"],
  estimatePointId: "e1",
};

describe("buildPublishPlan", () => {
  it("keeps every value that is still valid", () => {
    expect(buildPublishPlan(draft, facts)).toEqual({
      status: "doing",
      assigneeIds: ["u1", "u2"],
      customFieldValues: [{ fieldId: "f1", value: "x" }],
      cycleId: "c1",
      moduleIds: ["m1", "m2"],
      estimatePointId: "e1",
      dropped: [],
    });
  });

  it("uses the entry column for no status, and for a stale one it reports", () => {
    expect(buildPublishPlan({ ...draft, status: null }, facts)).toMatchObject({
      status: "to-do",
      dropped: [],
    });
    expect(buildPublishPlan({ ...draft, status: "gone" }, facts)).toMatchObject(
      {
        status: "to-do",
        dropped: ["status"],
      },
    );
    expect(
      buildPublishPlan({ ...draft, status: "planned" }, facts).status,
    ).toBe("planned");
    expect(
      buildPublishPlan({ ...draft, status: null }, { ...facts, columns: [] })
        .status,
    ).toBe("planned");
  });

  it("drops stale values in a fixed order", () => {
    const plan = buildPublishPlan(
      {
        ...draft,
        status: "gone",
        customFieldValues: [{ fieldId: "old", value: "y" }],
      },
      {
        ...facts,
        assignableIds: new Set(["u2"]),
        fieldIds: new Set(),
        cycle: {
          archivedAt: null,
          startDate: "2026-05-01",
          endDate: "2026-05-31",
        },
        activeModuleIds: new Set(["m2"]),
        pointActive: false,
      },
    );
    expect(plan).toEqual({
      status: "to-do",
      assigneeIds: ["u2"],
      customFieldValues: [],
      cycleId: null,
      moduleIds: ["m2"],
      estimatePointId: null,
      dropped: ["status", "assignees", "cycle", "modules", "estimate"],
    });
  });

  it("drops what a turned-off feature holds, and archived or foreign cycles", () => {
    expect(
      buildPublishPlan(draft, {
        ...facts,
        features: { cycles: false, modules: false, estimates: false },
      }).dropped,
    ).toEqual(["cycle", "modules", "estimate"]);
    expect(
      buildPublishPlan(draft, {
        ...facts,
        cycle: {
          ...facts.cycle,
          archivedAt: new Date(),
        } as PublishFacts["cycle"],
      }).dropped,
    ).toEqual(["cycle"]);
    expect(buildPublishPlan(draft, { ...facts, cycle: null }).dropped).toEqual([
      "cycle",
    ]);
    // A draft cycle (no dates) still takes tasks.
    expect(
      buildPublishPlan(draft, {
        ...facts,
        cycle: { archivedAt: null, startDate: null, endDate: null },
      }).cycleId,
    ).toBe("c1");
  });

  it("reports nothing for values the draft never had", () => {
    expect(
      buildPublishPlan(
        { ...EMPTY_DRAFT, projectId: "p1", title: "Bare" },
        {
          ...facts,
          features: { cycles: false, modules: false, estimates: false },
        },
      ).dropped,
    ).toEqual([]);
  });
});
