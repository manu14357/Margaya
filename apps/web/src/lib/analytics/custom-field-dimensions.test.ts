import { describe, expect, it } from "vitest";
import {
  builderAvailabilityOf,
  normalizeBuilderState,
  usesCustomField,
} from "./builder-state";
import {
  availabilityOf,
  availableDimensions,
  dimensionLabel,
  fieldsPending,
  isAnalyticsDimension,
  segmentOptions,
} from "./dimensions";
import { bucketLabel, type LabelContext, metricLabel } from "./labels";
import { builderStateOfReport } from "./report-config";
import { chartTableModel } from "./table-model";
import { makeChartResult } from "./test-fixtures";

// Custom fields in analytics: a project's dropdowns are dimensions and its
// numbers can be summed, while exactly one project is in scope.

const t: LabelContext["t"] = (key, options) =>
  options ? `${key} ${JSON.stringify(options)}` : key;

const fields = [
  { id: "tier", name: "Tier", type: "dropdown" },
  { id: "budget", name: "Budget", type: "number" },
  { id: "notes", name: "Notes", type: "text" },
];
const project = { id: "p1", cyclesEnabled: false };
const other = { id: "p2", cyclesEnabled: false };

describe("custom field dimensions", () => {
  it("offers a project's dropdowns after the categories and before the dates", () => {
    const offered = availableDimensions(availabilityOf([project], fields));
    expect(offered).toContain("customField:tier");
    expect(offered).not.toContain("customField:budget");
    expect(offered).not.toContain("customField:notes");
    const at = offered.indexOf("customField:tier");
    expect(offered[at - 1]).toBe("label");
    expect(offered[at + 1]).toBe("createdAt");
    expect(
      segmentOptions("priority", availabilityOf([project], fields)),
    ).toContain("customField:tier");
  });

  it("offers none with several projects, and none while they load", () => {
    const several = availabilityOf([project, other], fields);
    expect(availableDimensions(several).some(isCustomFieldKey)).toBe(false);
    expect(fieldsPending(several)).toBe(false);

    const loading = availabilityOf([project]);
    expect(availableDimensions(loading).some(isCustomFieldKey)).toBe(false);
    expect(fieldsPending(loading)).toBe(true);
  });

  it("names a field by its own name", () => {
    expect(dimensionLabel("customField:tier", t, fields)).toBe("Tier");
    expect(dimensionLabel("customField:gone", t, fields)).toBe(
      "analytics:dimensions.customField",
    );
    expect(dimensionLabel("priority", t, fields)).toBe(
      "analytics:dimensions.priority",
    );
    expect(isAnalyticsDimension("customField:tier")).toBe(true);
    expect(isAnalyticsDimension("customField:")).toBe(false);
  });

  it("labels values by their text and no value as No value", () => {
    const context = { t };
    expect(bucketLabel("customField:tier", "value:Gold", context)).toBe("Gold");
    // A value that reads like a token stays a value.
    expect(bucketLabel("customField:tier", "value:none", context)).toBe("none");
    expect(bucketLabel("customField:tier", "none", context)).toBe(
      "analytics:none.customField",
    );
    expect(bucketLabel("customField:tier", "other", context)).toBe(
      "analytics:other",
    );
  });

  it("names a summed metric after its field", () => {
    expect(metricLabel("customField:budget", t, fields)).toBe(
      'analytics:metric.sumOf {"name":"Budget"}',
    );
    expect(metricLabel("customField:gone", t, fields)).toBe(
      "analytics:metric.sum",
    );
    expect(metricLabel("estimatePoints", t)).toBe("analytics:metric.points");
    expect(metricLabel("taskCount", t)).toBe("analytics:metric.tasks");
  });
});

describe("builder state with custom fields", () => {
  const loaded = builderAvailabilityOf(
    availabilityOf([project], fields),
    false,
  );
  const pending = builderAvailabilityOf(availabilityOf([project]), false);
  const stored = {
    xAxis: "customField:tier",
    segment: "group",
    metric: "customField:budget",
  };

  it("keeps a stored field that still exists", () => {
    const state = normalizeBuilderState(stored, loaded);
    expect(state).toMatchObject(stored);
    expect(usesCustomField(state)).toBe(true);
  });

  it("keeps a stored field while the fields load", () => {
    expect(normalizeBuilderState(stored, pending)).toMatchObject(stored);
  });

  it("drops a deleted field, a field of the wrong type and fields across projects", () => {
    const gone = normalizeBuilderState(
      { xAxis: "customField:gone", metric: "customField:gone" },
      loaded,
    );
    expect(gone.xAxis).toBe("priority");
    expect(gone.metric).toBe("taskCount");

    const wrongType = normalizeBuilderState(
      {
        xAxis: "customField:budget",
        segment: "customField:notes",
        metric: "customField:tier",
      },
      loaded,
    );
    expect(wrongType).toMatchObject({
      xAxis: "priority",
      segment: null,
      metric: "taskCount",
    });

    const several = builderAvailabilityOf(
      availabilityOf([project, other], fields),
      false,
    );
    expect(normalizeBuilderState(stored, several)).toMatchObject({
      xAxis: "priority",
      metric: "taskCount",
    });
  });

  it("opens a report on a field in another scope until that scope's fields say otherwise", () => {
    const { state, reset } = builderStateOfReport(
      { xAxis: "customField:tier", metric: "customField:budget" },
      pending,
    );
    expect(reset).toBe(false);
    expect(state).toMatchObject({
      xAxis: "customField:tier",
      metric: "customField:budget",
    });
  });
});

describe("custom field tables", () => {
  it("adds a task count column beside a summed field", () => {
    const result = makeChartResult({
      xAxis: "customField:tier",
      segment: null,
      segments: [],
      metric: "customField:budget",
      multiValued: { x: false, segment: false },
      buckets: [
        { key: "value:Gold", value: 300.5, taskCount: 2, progress: null },
        { key: "none", value: 0, taskCount: 1, progress: null },
      ],
    });
    const model = chartTableModel(result, {
      t,
      dimensionLabel: "Tier",
      metricLabel: "Sum of Budget",
      labelOf: (dimension, key) => bucketLabel(dimension, key, { t }),
    });
    expect(model.columns.map((column) => column.label)).toEqual([
      "Tier",
      "Sum of Budget",
      "analytics:table.tasks",
    ]);
    expect(model.rows.map((row) => row.cells)).toEqual([
      { name: "Gold", value: 300.5, taskCount: 2 },
      { name: "analytics:none.customField", value: 0, taskCount: 1 },
    ]);
  });
});

function isCustomFieldKey(dimension: string) {
  return dimension.startsWith("customField:");
}
