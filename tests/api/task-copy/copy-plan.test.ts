import { describe, expect, it } from "vitest";
import {
  type CopyColumn,
  DEFAULT_COPY_OPTIONS,
  planCopyOptions,
  planCustomFieldValues,
  resolveCopyStatus,
  rewriteAssetUrls,
  type SourceData,
} from "../../../apps/api/src/task-copy/copy-plan";

const everything: SourceData = {
  description: true,
  assignees: true,
  labels: true,
  dates: true,
  customFields: true,
  parent: true,
  planning: true,
  links: true,
  attachments: true,
};

describe("planCopyOptions", () => {
  it("applies the default options in the same project", () => {
    const { apply, skipped } = planCopyOptions({
      requested: DEFAULT_COPY_OPTIONS,
      sameProject: true,
      sourceHas: everything,
    });
    expect([...apply]).toEqual([
      "description",
      "assignees",
      "labels",
      "dates",
      "customFields",
      "parent",
      "planning",
    ]);
    expect(skipped).toEqual([]);
  });

  it("reports parent, custom fields and planning as skipped across projects", () => {
    const { apply, skipped } = planCopyOptions({
      requested: [...DEFAULT_COPY_OPTIONS, "links", "attachments"],
      sameProject: false,
      sourceHas: everything,
    });
    expect([...apply]).toEqual([
      "description",
      "assignees",
      "labels",
      "dates",
      "links",
      "attachments",
    ]);
    expect(skipped).toEqual(["customFields", "parent", "planning"]);
  });

  it("ignores options the source has nothing for", () => {
    const { apply, skipped } = planCopyOptions({
      requested: ["parent", "planning", "links", "labels"],
      sameProject: false,
      sourceHas: {
        ...everything,
        parent: false,
        planning: false,
        links: false,
      },
    });
    expect([...apply]).toEqual(["labels"]);
    expect(skipped).toEqual([]);
  });

  it("copies only what was asked for, once", () => {
    const { apply } = planCopyOptions({
      requested: ["dates", "dates", "links"],
      sameProject: true,
      sourceHas: everything,
    });
    expect([...apply]).toEqual(["dates", "links"]);
  });
});

const columns: CopyColumn[] = [
  { id: "c-done", slug: "done", position: 3, group: "completed" },
  { id: "c-todo", slug: "to-do", position: 1, group: "unstarted" },
  { id: "c-doing", slug: "in-progress", position: 2, group: "started" },
  { id: "c-triage", slug: "triage", position: 0, group: "triage" },
];

describe("resolveCopyStatus", () => {
  it("keeps the column with the same slug", () => {
    expect(resolveCopyStatus("done", columns)).toEqual({
      status: "done",
      columnId: "c-done",
      group: "completed",
    });
  });

  it("falls back to the entry column", () => {
    expect(resolveCopyStatus("qa-review", columns)).toEqual({
      status: "to-do",
      columnId: "c-todo",
      group: "unstarted",
    });
  });

  it("keeps planned tasks planned", () => {
    expect(resolveCopyStatus("planned", [])).toEqual({
      status: "planned",
      columnId: null,
      group: "backlog",
    });
  });

  it("sends a legacy archived status to the entry column", () => {
    expect(resolveCopyStatus("archived", columns)?.status).toBe("to-do");
  });

  it("never lands in a triage column", () => {
    expect(resolveCopyStatus("triage", columns)?.status).toBe("to-do");
  });

  it("uses the first open column when nothing is unstarted", () => {
    expect(
      resolveCopyStatus("missing", [
        { id: "c-done", slug: "done", position: 1, group: "completed" },
        { id: "c-doing", slug: "doing", position: 2, group: "started" },
      ])?.status,
    ).toBe("doing");
  });

  it("gives up without an open column", () => {
    expect(
      resolveCopyStatus("missing", [
        { id: "c-done", slug: "done", position: 1, group: "completed" },
      ]),
    ).toBeNull();
  });
});

describe("planCustomFieldValues", () => {
  const fields = [
    { id: "f-opt", name: "Notes", required: false, defaultValue: null },
    { id: "f-req", name: "Team", required: true, defaultValue: null },
    { id: "f-def", name: "Env", required: true, defaultValue: "prod" },
  ];

  it("copies every filled value when asked", () => {
    const result = planCustomFieldValues({
      targetFields: fields,
      sourceValues: new Map([
        ["f-opt", "hello"],
        ["f-req", "core"],
        ["f-def", "staging"],
      ]),
      copyAll: true,
    });
    expect(result).toEqual({
      ok: true,
      values: [
        { fieldId: "f-opt", value: "hello" },
        { fieldId: "f-req", value: "core" },
        { fieldId: "f-def", value: "staging" },
      ],
    });
  });

  it("keeps required values even when the option is off", () => {
    const result = planCustomFieldValues({
      targetFields: fields,
      sourceValues: new Map([
        ["f-opt", "hello"],
        ["f-req", "core"],
      ]),
      copyAll: false,
    });
    expect(result).toEqual({
      ok: true,
      values: [
        { fieldId: "f-req", value: "core" },
        { fieldId: "f-def", value: "prod" },
      ],
    });
  });

  it("refuses a required field with neither a value nor a default", () => {
    expect(
      planCustomFieldValues({
        targetFields: fields,
        sourceValues: new Map([["f-req", "  "]]),
        copyAll: true,
      }),
    ).toEqual({ ok: false, missingField: "Team" });
  });
});

describe("rewriteAssetUrls", () => {
  it("rewrites only mapped ids, every time, and keeps hosts", () => {
    const description = [
      "![a](https://api.example.com/api/asset/aaa111)",
      "![b](/api/asset/bbb222)",
      "again /api/asset/aaa111?download=1",
      "foreign https://other.example/api/asset/ccc333",
    ].join("\n");
    expect(
      rewriteAssetUrls(
        description,
        new Map([
          ["aaa111", "new111"],
          ["bbb222", "new222"],
        ]),
      ),
    ).toBe(
      [
        "![a](https://api.example.com/api/asset/new111)",
        "![b](/api/asset/new222)",
        "again /api/asset/new111?download=1",
        "foreign https://other.example/api/asset/ccc333",
      ].join("\n"),
    );
  });

  it("leaves a description without mapped ids untouched", () => {
    expect(rewriteAssetUrls("/api/asset/x1", new Map())).toBe("/api/asset/x1");
  });
});
