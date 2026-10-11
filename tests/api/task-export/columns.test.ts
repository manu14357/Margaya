import { describe, expect, it } from "vitest";
import type { ExportTask } from "../../../apps/api/src/task-export/collect";
import {
  customFieldCell,
  customFieldColumns,
  exportHeader,
  exportRow,
  FIXED_HEADERS,
  formatEstimate,
  formatMinutes,
  taskJson,
} from "../../../apps/api/src/task-export/columns";
import { JsonTaskDocument } from "../../../apps/api/src/task-export/encoders/json";

const project = {
  id: "p1",
  name: "Website",
  slug: "web",
  cyclesEnabled: true,
  modulesEnabled: true,
  estimatesEnabled: true,
  timeTrackingEnabled: true,
};

function task(overrides: Partial<ExportTask> = {}): ExportTask {
  return {
    id: "t1",
    project,
    key: "WEB-12",
    number: 12,
    parent: { id: "t0", key: "WEB-1" },
    title: "Fix login",
    description: "Steps",
    status: { slug: "to-do", name: "To Do" },
    group: "unstarted",
    priority: "high",
    assignees: [
      { id: "u1", name: "Ada", email: "ada@x.test" },
      { id: "u2", name: "Mia", email: "mia@x.test" },
    ],
    subscribers: [{ id: "u3", name: "Owen" }],
    createdBy: { id: "u1", name: "Ada" },
    startDate: null,
    dueDate: new Date("2026-10-01T00:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-09-01T08:00:00Z"),
    updatedAt: new Date("2026-09-02T08:00:00Z"),
    archivedAt: null,
    estimate: { value: "90", type: "time" },
    labels: [{ name: "bug", color: "#f00" }],
    cycle: { id: "c1", name: "Sprint 3" },
    modules: [{ id: "m1", name: "Auth" }],
    links: [{ title: "Spec", url: "https://x.test/spec" }],
    relations: [{ type: "blocks", task: "WEB-14", direction: "outgoing" }],
    comments: [
      {
        author: "Mia",
        createdAt: new Date("2026-09-03T08:00:00Z"),
        text: "Looks good",
      },
    ],
    commentsTruncated: false,
    subTaskCount: 2,
    linkCount: 1,
    attachmentCount: 3,
    timeLoggedMinutes: 45,
    customFields: [
      { name: "Severity", type: "number", value: "3" },
      { name: "Customer", type: "text", value: "Acme" },
    ],
    ...overrides,
  };
}

describe("formats", () => {
  it("formats durations like the app", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("formats each estimate system", () => {
    expect(formatEstimate({ value: "90", type: "time" })).toBe("1h 30m");
    expect(formatEstimate({ value: "2.50", type: "points" })).toBe("2.5");
    expect(formatEstimate({ value: "XL", type: "categories" })).toBe("XL");
    expect(formatEstimate(null)).toBe("");
  });
});

describe("columns", () => {
  it("keeps the documented header order", () => {
    expect(FIXED_HEADERS).toEqual([
      "Project",
      "Key",
      "Number",
      "Parent",
      "Title",
      "Description",
      "Status",
      "Status group",
      "Priority",
      "Assignees",
      "Assignee emails",
      "Subscribers",
      "Created by",
      "Start date",
      "Due date",
      "Completed at",
      "Created at",
      "Updated at",
      "Archived at",
      "Estimate",
      "Labels",
      "Cycle",
      "Modules",
      "Links",
      "Relations",
      "Comments",
      "Sub-tasks",
      "Link count",
      "Attachment count",
      "Time logged (minutes)",
    ]);
  });

  it("merges custom fields by name in project order and caps them at 50", () => {
    const fields = [
      { projectId: "p1", name: "Severity", type: "number" },
      { projectId: "p1", name: "Customer", type: "text" },
      { projectId: "p2", name: "Severity", type: "dropdown" },
      { projectId: "p2", name: "Team", type: "text" },
    ];
    expect(customFieldColumns(fields)).toEqual([
      "Severity",
      "Customer",
      "Team",
    ]);
    const many = Array.from({ length: 60 }, (_, index) => ({
      projectId: "p1",
      name: `F${index}`,
      type: "text",
    }));
    expect(customFieldColumns(many)).toHaveLength(50);
    expect(exportHeader(["Severity"]).at(-1)).toBe("Custom: Severity");
  });

  it("types custom-field cells", () => {
    expect(customFieldCell({ type: "number", value: "3.5" })).toBe(3.5);
    expect(customFieldCell({ type: "number", value: "abc" })).toBe("abc");
    expect(customFieldCell({ type: "boolean", value: "true" })).toBe(true);
    expect(customFieldCell({ type: "date", value: "2026-01-01" })).toBe(
      "2026-01-01",
    );
    expect(customFieldCell(undefined)).toBeNull();
  });

  it("builds a row with the key, names, emails and formatted values", () => {
    const row = exportRow(task(), ["Severity", "Team", "Customer"]);
    expect(row).toHaveLength(FIXED_HEADERS.length + 3);
    const cell = (header: string) => row[FIXED_HEADERS.indexOf(header)];
    expect(cell("Key")).toBe("WEB-12");
    expect(cell("Parent")).toBe("WEB-1");
    expect(cell("Assignees")).toEqual(["Ada", "Mia"]);
    expect(cell("Assignee emails")).toEqual(["ada@x.test", "mia@x.test"]);
    expect(cell("Estimate")).toBe("1h 30m");
    expect(cell("Cycle")).toBe("Sprint 3");
    expect(cell("Time logged (minutes)")).toBe(45);
    expect(row.slice(FIXED_HEADERS.length)).toEqual([3, null, "Acme"]);
  });

  it("shapes JSON with nested values and flags truncated comments", () => {
    const json = taskJson(task({ commentsTruncated: true }));
    expect(json.project).toEqual({ id: "p1", name: "Website", slug: "web" });
    expect(json.status).toEqual({ slug: "to-do", name: "To Do" });
    expect(json.estimate).toEqual({ value: "90", type: "time" });
    expect(json.commentsTruncated).toBe(true);
    expect(json.assignees).toEqual([
      { id: "u1", name: "Ada", email: "ada@x.test" },
      { id: "u2", name: "Mia", email: "mia@x.test" },
    ]);
    expect("commentsTruncated" in taskJson(task())).toBe(false);
  });
});

describe("JsonTaskDocument", () => {
  const meta = { schema: "margaya.task-export.v1", options: { a: true } };

  it("writes exactly what JSON.stringify writes", () => {
    const tasks = [{ id: "a", nested: { list: [1, 2] } }, { id: "b" }];
    const document = new JsonTaskDocument(meta);
    const text =
      document.head() +
      tasks.map((value) => document.task(value)).join("") +
      document.tail();
    expect(text).toBe(`${JSON.stringify({ ...meta, tasks }, null, 2)}\n`);
  });

  it("writes an empty task list", () => {
    const document = new JsonTaskDocument(meta);
    expect(document.head() + document.tail()).toBe(
      `${JSON.stringify({ ...meta, tasks: [] }, null, 2)}\n`,
    );
  });
});
