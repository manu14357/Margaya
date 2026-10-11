import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import {
  applyDraftChanges,
  EMPTY_DRAFT,
  normalizeCustomFieldValues,
  normalizeIds,
  normalizeLabels,
  parseDraftPatch,
  visibleDraftValues,
} from "../../../apps/api/src/task-draft/normalize";

const inProject = {
  ...EMPTY_DRAFT,
  projectId: "p1",
  title: "Draft",
  status: "to-do",
  assigneeIds: ["u1"],
  labels: [{ name: "UI", color: "purple" }],
  customFieldValues: [{ fieldId: "f1", value: "x" }],
  cycleId: "c1",
  moduleIds: ["m1"],
  estimatePointId: "e1",
};

describe("draft normalization", () => {
  it("trims label names and keeps the last duplicate, ignoring case", () => {
    expect(
      normalizeLabels([
        { name: " UI ", color: "purple" },
        { name: "Bug", color: "red" },
        { name: "ui", color: "teal" },
        { name: "   ", color: "gray" },
      ]),
    ).toEqual([
      { name: "Bug", color: "red" },
      { name: "ui", color: "teal" },
    ]);
  });

  it("keeps one custom field value per field, the last one", () => {
    expect(
      normalizeCustomFieldValues([
        { fieldId: "a", value: "1" },
        { fieldId: "b", value: "2" },
        { fieldId: "a", value: "3" },
      ]),
    ).toEqual([
      { fieldId: "a", value: "3" },
      { fieldId: "b", value: "2" },
    ]);
  });

  it("trims ids and keeps their first place", () => {
    expect(normalizeIds([" a", "b", "a ", ""])).toEqual(["a", "b"]);
  });

  it("parses only the sent keys, with dates and assignees normalized", () => {
    expect(
      parseDraftPatch({
        title: "  Hello ",
        startDate: "2026-05-01",
        dueDate: null,
        assigneeIds: ["u2", "u2", "u3"],
      }),
    ).toEqual({
      title: "Hello",
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      dueDate: null,
      assigneeIds: ["u2", "u3"],
    });
    expect(() => parseDraftPatch({ startDate: "someday" })).toThrow(
      HTTPException,
    );
    expect(() =>
      parseDraftPatch({
        assigneeIds: Array.from({ length: 21 }, (_, i) => `u${i}`),
      }),
    ).toThrow(HTTPException);
  });
});

describe("applyDraftChanges", () => {
  it("clears project-bound values on a project change, keeping people and labels", () => {
    const { next, changed, projectChanged } = applyDraftChanges(inProject, {
      projectId: "p2",
    });
    expect(projectChanged).toBe(true);
    expect(next).toMatchObject({
      projectId: "p2",
      status: null,
      customFieldValues: [],
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
      assigneeIds: ["u1"],
      labels: [{ name: "UI", color: "purple" }],
    });
    expect(changed.sort()).toEqual(
      [
        "customFieldValues",
        "cycleId",
        "estimatePointId",
        "moduleIds",
        "projectId",
        "status",
      ].sort(),
    );
  });

  it("keeps project-bound values sent with the new project", () => {
    const { next } = applyDraftChanges(inProject, {
      projectId: "p2",
      status: "done",
      moduleIds: ["m9"],
    });
    expect(next).toMatchObject({
      status: "done",
      moduleIds: ["m9"],
      cycleId: null,
    });
  });

  it("reports no change when every sent value is already stored", () => {
    const { changed, projectChanged } = applyDraftChanges(inProject, {
      projectId: "p1",
      title: "Draft",
      labels: [{ name: "UI", color: "purple" }],
    });
    expect(changed).toEqual([]);
    expect(projectChanged).toBe(false);
    const withDate = { ...inProject, dueDate: new Date("2026-01-01") };
    expect(
      applyDraftChanges(withDate, { dueDate: new Date("2026-01-01") }).changed,
    ).toEqual([]);
  });

  it("does not share arrays with the empty draft", () => {
    const { next } = applyDraftChanges(inProject, { projectId: null });
    next.moduleIds.push("leak");
    expect(EMPTY_DRAFT.moduleIds).toEqual([]);
  });
});

describe("visibleDraftValues", () => {
  it("blanks project-bound values without a project", () => {
    expect(visibleDraftValues({ ...inProject, projectId: null })).toMatchObject(
      {
        projectId: null,
        status: null,
        customFieldValues: [],
        cycleId: null,
        moduleIds: [],
        estimatePointId: null,
        assigneeIds: ["u1"],
      },
    );
    expect(visibleDraftValues(inProject)).toBe(inProject);
  });
});
