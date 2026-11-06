import { describe, expect, it } from "vitest";
import {
  planCustomFieldEdit,
  renameInDraftValues,
  renameInRuleConditions,
  renameInViewFilters,
} from "../../../apps/api/src/custom-field/option-edits";

const dropdown = {
  name: "Stage",
  type: "dropdown",
  required: false,
  defaultValue: null as string | null,
  options: ["Alpha", "Beta"],
};

function refused(run: () => unknown, message: RegExp) {
  expect(run).toThrow(message);
}

describe("planCustomFieldEdit", () => {
  it("trims the name and changes nothing else", () => {
    expect(planCustomFieldEdit(dropdown, { name: " Phase " })).toEqual({
      changes: { name: "Phase" },
      renames: new Map(),
    });
  });

  it("carries a renamed default along", () => {
    const plan = planCustomFieldEdit(
      { ...dropdown, defaultValue: "Beta" },
      {
        options: ["Alpha", "Bravo"],
        renamedOptions: [{ from: "Beta", to: "Bravo" }],
      },
    );
    expect(plan.changes.defaultValue).toBe("Bravo");
    expect([...plan.renames]).toEqual([["Beta", "Bravo"]]);
  });

  it("allows a swap and a merge", () => {
    expect(
      planCustomFieldEdit(dropdown, {
        options: ["Beta", "Alpha"],
        renamedOptions: [
          { from: "Alpha", to: "Beta" },
          { from: "Beta", to: "Alpha" },
        ],
      }).renames.size,
    ).toBe(2);
    expect(
      planCustomFieldEdit(dropdown, {
        options: ["Alpha"],
        renamedOptions: [{ from: "Beta", to: "Alpha" }],
      }).renames.get("Beta"),
    ).toBe("Alpha");
  });

  it("treats a rename to the same text as no rename", () => {
    expect(
      planCustomFieldEdit(dropdown, {
        options: ["Alpha", "Beta"],
        renamedOptions: [{ from: "Beta", to: "Beta" }],
      }).renames.size,
    ).toBe(0);
  });

  it("refuses options that can't work", () => {
    const edit = (options: string[]) => () =>
      planCustomFieldEdit(dropdown, { options });
    refused(edit([]), /at least one/);
    refused(edit(["  "]), /at least one/);
    refused(edit(["A", " A "]), /different/);
    refused(
      () =>
        planCustomFieldEdit(
          { ...dropdown, type: "text", options: null },
          { options: ["A"] },
        ),
      /Only dropdown/,
    );
  });

  it("refuses renames that don't fit the options", () => {
    const edit = (renamedOptions: { from: string; to: string }[]) => () =>
      planCustomFieldEdit(dropdown, {
        options: ["Alpha", "Beta", "Gamma"],
        renamedOptions,
      });
    refused(edit([{ from: "Nope", to: "Gamma" }]), /Unknown option/);
    refused(edit([{ from: "Beta", to: "Nope" }]), /not in the new options/);
    refused(edit([{ from: "Beta", to: "Gamma" }]), /both kept and renamed/);
    refused(
      () =>
        planCustomFieldEdit(dropdown, {
          renamedOptions: [{ from: "Beta", to: "Gamma" }],
        }),
      /full new options/,
    );
  });

  it("keeps the default valid", () => {
    refused(
      () =>
        planCustomFieldEdit(
          { ...dropdown, defaultValue: "Beta" },
          { options: ["Alpha"] },
        ),
      /one of the dropdown options/,
    );
    refused(
      () =>
        planCustomFieldEdit(
          { ...dropdown, required: true, defaultValue: "Beta" },
          { defaultValue: null },
        ),
      /must have a default/,
    );
    refused(
      () =>
        planCustomFieldEdit(
          { ...dropdown, type: "number", options: null },
          { defaultValue: "abc" },
        ),
      /./,
    );
    refused(
      () =>
        planCustomFieldEdit(
          { ...dropdown, type: "date", options: null },
          { defaultValue: "2026-02-31" },
        ),
      /valid ISO 8601/,
    );
    refused(
      () =>
        planCustomFieldEdit(
          { ...dropdown, type: "boolean", options: null },
          { defaultValue: "maybe" },
        ),
      /'true' or 'false'/,
    );
    expect(
      planCustomFieldEdit(
        { ...dropdown, defaultValue: "Beta" },
        { defaultValue: "" },
      ).changes.defaultValue,
    ).toBeNull();
  });
});

describe("rename helpers", () => {
  const renames = new Map([["Beta", "Bravo"]]);

  it("rewrites only the field's conditions in a view's filter tree", () => {
    const filters = {
      version: 1,
      archived: "exclude",
      root: {
        op: "and",
        children: [
          {
            key: "customField",
            fieldId: "f1",
            operator: "in",
            values: ["Beta", "none"],
          },
          {
            key: "customField",
            fieldId: "f2",
            operator: "in",
            values: ["Beta"],
          },
        ],
      },
    };
    expect(renameInViewFilters(filters, "f1", renames)).toEqual({
      ...filters,
      root: {
        op: "and",
        children: [
          {
            key: "customField",
            fieldId: "f1",
            operator: "in",
            values: ["Bravo", "none"],
          },
          filters.root.children[1],
        ],
      },
    });
    expect(renameInViewFilters(filters, "f3", renames)).toBeNull();
  });

  it("never treats the filter's none token as an option", () => {
    const filters = {
      root: {
        key: "customField",
        fieldId: "f1",
        operator: "in",
        values: ["none"],
      },
    };
    expect(
      renameInViewFilters(filters, "f1", new Map([["none", "Nil"]])),
    ).toBeNull();
  });

  it("rewrites nested automation conditions", () => {
    const leaf = {
      field: "custom_field",
      fieldId: "f1",
      op: "equals",
      value: "Beta",
    };
    expect(
      renameInRuleConditions(
        { op: "and", conditions: [{ op: "or", conditions: [leaf] }] },
        "f1",
        renames,
      ),
    ).toEqual({
      op: "and",
      conditions: [{ op: "or", conditions: [{ ...leaf, value: "Bravo" }] }],
    });
    expect(
      renameInRuleConditions({ op: "and", conditions: [leaf] }, "f2", renames),
    ).toBeNull();
    expect(renameInRuleConditions(null, "f1", renames)).toBeNull();
  });

  it("rewrites draft values", () => {
    expect(
      renameInDraftValues(
        [
          { fieldId: "f1", value: "Beta" },
          { fieldId: "f2", value: "Beta" },
        ],
        "f1",
        renames,
      ),
    ).toEqual([
      { fieldId: "f1", value: "Bravo" },
      { fieldId: "f2", value: "Beta" },
    ]);
    expect(
      renameInDraftValues([{ fieldId: "f1", value: "Alpha" }], "f1", renames),
    ).toBeNull();
  });
});
