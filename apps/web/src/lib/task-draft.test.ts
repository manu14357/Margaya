import { describe, expect, it } from "vitest";
import type { TaskDraft } from "@/types/task-draft";
import {
  canPublishDraft,
  type DraftFormValues,
  diffDraftFields,
  displayTaskKey,
  draftToFormValues,
  droppedListLabel,
  formToDraftFields,
  hasDraftContent,
  isEmptyPatch,
} from "./task-draft";

function emptyForm(overrides: Partial<DraftFormValues> = {}): DraftFormValues {
  return {
    projectId: "",
    title: "",
    description: "",
    status: null,
    priority: "no-priority",
    assigneeIds: [],
    labels: [],
    customFieldValues: {},
    slotValues: {},
    ...overrides,
  };
}

const draft: TaskDraft = {
  id: "d1",
  workspaceId: "w1",
  projectId: "p1",
  project: { id: "p1", name: "Web", slug: "web", icon: null, archived: false },
  title: "Fix login",
  description: "Steps",
  status: "doing",
  priority: "high",
  assigneeIds: ["ana", "ben"],
  labels: [{ name: "bug", color: "red" }],
  startDate: "2026-05-01T00:00:00.000Z",
  dueDate: null,
  customFieldValues: [{ fieldId: "f1", value: "3" }],
  cycleId: "c1",
  moduleIds: ["m1", "m2"],
  estimatePointId: "e1",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
};

describe("formToDraftFields", () => {
  it("maps the form and the create-modal slots to draft fields", () => {
    const fields = formToDraftFields(
      emptyForm({
        projectId: "p1",
        title: "  Title  ",
        description: " body ",
        status: "doing",
        priority: "urgent",
        assigneeIds: ["ana", "ana", "ben"],
        labels: [
          { name: "Bug", color: "red" },
          { name: "bug", color: "green" },
        ],
        dueDate: new Date("2026-06-01T00:00:00.000Z"),
        customFieldValues: { f1: "3", f2: "  " },
        slotValues: { cycle: "c1", module: ["m1", "m1"], estimate: "e1" },
      }),
    );
    expect(fields).toEqual({
      projectId: "p1",
      title: "Title",
      description: "body",
      status: "doing",
      priority: "urgent",
      assigneeIds: ["ana", "ben"],
      labels: [{ name: "bug", color: "green" }],
      startDate: null,
      dueDate: "2026-06-01T00:00:00.000Z",
      customFieldValues: [{ fieldId: "f1", value: "3" }],
      cycleId: "c1",
      moduleIds: ["m1"],
      estimatePointId: "e1",
    });
  });

  it("keeps project-bound values out of a draft without a project", () => {
    const fields = formToDraftFields(
      emptyForm({
        status: "doing",
        customFieldValues: { f1: "3" },
        slotValues: { cycle: "c1", module: ["m1"], estimate: "e1" },
      }),
    );
    expect(fields).toMatchObject({
      projectId: null,
      status: null,
      customFieldValues: [],
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
    });
  });

  it("treats unknown priorities and empty slot values as unset", () => {
    const fields = formToDraftFields(
      emptyForm({ projectId: "p1", priority: "?", slotValues: { cycle: "" } }),
    );
    expect(fields.priority).toBe("no-priority");
    expect(fields.cycleId).toBeNull();
  });
});

describe("draftToFormValues", () => {
  it("round-trips a stored draft", () => {
    const values = draftToFormValues(draft);
    expect(values.slotValues).toEqual({
      cycle: "c1",
      module: ["m1", "m2"],
      estimate: "e1",
    });
    expect(values.startDate?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(values.dueDate).toBeUndefined();
    const fields = formToDraftFields(values);
    expect(fields).toMatchObject({
      projectId: "p1",
      status: "doing",
      cycleId: "c1",
      moduleIds: ["m1", "m2"],
      estimatePointId: "e1",
      customFieldValues: [{ fieldId: "f1", value: "3" }],
    });
  });

  it("leaves slots unset for a draft without them", () => {
    const values = draftToFormValues({
      ...draft,
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
    });
    expect(values.slotValues).toEqual({});
  });
});

describe("hasDraftContent", () => {
  it("is false for an empty dialog", () => {
    expect(hasDraftContent(emptyForm())).toBe(false);
    expect(hasDraftContent(emptyForm({ title: "   " }))).toBe(false);
  });

  it.each<Partial<DraftFormValues>>([
    { title: "x" },
    { description: "x" },
    { projectId: "p1" },
    { priority: "low" },
    { assigneeIds: ["ana"] },
    { labels: [{ name: "bug", color: "red" }] },
    { dueDate: new Date() },
  ])("is true with %o", (overrides) => {
    expect(hasDraftContent(emptyForm(overrides))).toBe(true);
  });
});

describe("diffDraftFields", () => {
  const base = formToDraftFields(draftToFormValues(draft));

  it("is empty when nothing changed", () => {
    expect(isEmptyPatch(diffDraftFields(base, base))).toBe(true);
  });

  it("sends only the changed fields", () => {
    expect(
      diffDraftFields(base, { ...base, title: "New", priority: "low" }),
    ).toEqual({ title: "New", priority: "low" });
  });

  it("sends every project-bound field with a project change", () => {
    const next = {
      ...base,
      projectId: "p2",
      status: null,
      customFieldValues: [],
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
    };
    expect(diffDraftFields(base, next)).toEqual({
      projectId: "p2",
      status: null,
      customFieldValues: [],
      cycleId: null,
      moduleIds: [],
      estimatePointId: null,
    });
  });
});

describe("publish helpers", () => {
  it("needs a project and a title", () => {
    expect(canPublishDraft({ projectId: "p1", title: "x" })).toBe(true);
    expect(canPublishDraft({ projectId: null, title: "x" })).toBe(false);
    expect(canPublishDraft({ projectId: "p1", title: "  " })).toBe(false);
  });

  it("names the dropped properties", () => {
    expect(droppedListLabel(["status", "cycle"], (key) => `<${key}>`)).toBe(
      "<tasks:drafts.dropped.status>, <tasks:drafts.dropped.cycle>",
    );
  });

  it("shows task keys in upper case", () => {
    expect(displayTaskKey("web-12")).toBe("WEB-12");
  });
});
