import { describe, expect, it } from "vitest";
import {
  applyTitlePattern,
  EMPTY_TEMPLATE_FORM,
  fillFormFromTemplate,
  formToTemplateBody,
  moveItem,
  patternMakesTitle,
} from "./task-template";

const template = {
  titlePattern: "Bug: {title}",
  description: "Steps to reproduce",
  priority: "high",
  assigneeIds: ["u1"],
  labels: [
    { id: "l1", name: "bug", color: "red" },
    { id: "l2", name: "triage", color: "gray" },
  ],
  column: { id: "c1", name: "Review", slug: "review" },
  estimatePointId: "p1",
  subtasks: ["Reproduce", "Fix"],
};

const emptyForm = {
  title: "",
  description: "",
  priority: "no-priority",
  assigneeIds: [] as string[],
  labels: [] as Array<{ name: string; color: string }>,
};

describe("applyTitlePattern", () => {
  it("replaces {title} and collapses spaces", () => {
    expect(applyTitlePattern("Bug: {title}", " crash on save ")).toBe(
      "Bug: crash on save",
    );
    expect(applyTitlePattern("[{title}] check", "")).toBe("[] check");
    expect(applyTitlePattern("Bug:  {title}  now", "")).toBe("Bug: now");
  });

  it("appends the typed title after a pattern without the placeholder", () => {
    expect(applyTitlePattern("Release", "2.1")).toBe("Release 2.1");
    expect(applyTitlePattern("", "Only typed")).toBe("Only typed");
    expect(applyTitlePattern("Release", "")).toBe("Release");
  });

  it("knows when a pattern makes a title on its own", () => {
    expect(patternMakesTitle("Weekly review")).toBe(true);
    expect(patternMakesTitle("{title}")).toBe(false);
    expect(patternMakesTitle("  ")).toBe(false);
  });
});

describe("formToTemplateBody", () => {
  it("trims, drops blank sub-tasks and duplicate ids", () => {
    expect(
      formToTemplateBody({
        ...EMPTY_TEMPLATE_FORM,
        name: "  Bug ",
        titlePattern: " Bug: {title} ",
        priority: "bogus",
        labelIds: ["l1", "l1"],
        assigneeIds: ["u1", "u2", "u1"],
        subtasks: [" Reproduce ", "  ", "Fix"],
      }),
    ).toEqual({
      name: "Bug",
      titlePattern: "Bug: {title}",
      description: "",
      columnId: null,
      priority: null,
      labelIds: ["l1"],
      assigneeIds: ["u1", "u2"],
      estimatePointId: null,
      subtasks: ["Reproduce", "Fix"],
    });
  });
});

describe("moveItem", () => {
  it("moves within bounds and leaves the ends alone", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("fillFormFromTemplate", () => {
  it("fills an empty form with every template value", () => {
    const fill = fillFormFromTemplate(template, {
      ...emptyForm,
      title: "crash on save",
    });
    expect(fill).toMatchObject({
      title: "Bug: crash on save",
      description: "Steps to reproduce",
      priority: "high",
      assigneeIds: ["u1"],
      status: "review",
      estimatePointId: "p1",
      subtasks: ["Reproduce", "Fix"],
    });
    expect(fill.addLabels.map((label) => label.name)).toEqual([
      "bug",
      "triage",
    ]);
  });

  it("keeps what the template leaves open and what is already there", () => {
    const fill = fillFormFromTemplate(
      {
        ...template,
        titlePattern: "",
        description: "Checklist",
        priority: null,
        assigneeIds: [],
        column: null,
        estimatePointId: null,
      },
      {
        title: "Typed",
        description: "Notes",
        priority: "low",
        assigneeIds: ["u9"],
        labels: [{ name: "BUG", color: "red" }],
      },
    );
    expect(fill.title).toBe("Typed");
    expect(fill.description).toBe("Notes\n\nChecklist");
    expect(fill.priority).toBe("low");
    expect(fill.assigneeIds).toBeNull();
    expect(fill.status).toBeNull();
    expect(fill.addLabels.map((label) => label.name)).toEqual(["triage"]);
  });

  it("replaces what an earlier template wrote, unless it was edited", () => {
    const first = fillFormFromTemplate(template, {
      ...emptyForm,
      title: "crash",
    });
    const second = fillFormFromTemplate(
      { ...template, titlePattern: "Task: {title}", description: "Other" },
      { ...emptyForm, title: first.title, description: first.description },
      first.trace,
    );
    expect(second.title).toBe("Task: crash");
    expect(second.description).toBe("Other");

    const edited = fillFormFromTemplate(
      { ...template, titlePattern: "Task: {title}", description: "" },
      { ...emptyForm, title: "Bug: crash (edited)", description: "Mine" },
      first.trace,
    );
    expect(edited.title).toBe("Task: Bug: crash (edited)");
    expect(edited.description).toBe("Mine");
  });
});
