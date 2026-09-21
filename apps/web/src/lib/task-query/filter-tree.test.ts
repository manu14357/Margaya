import { describe, expect, it } from "vitest";
import {
  conditionId,
  countConditions,
  findRootCondition,
  isNestedTree,
  isSameValue,
  mergeBaseConditions,
  removeRootCondition,
  rootConditions,
  rootOp,
  setConditionValues,
  setRootCondition,
  setRootOp,
  stableHash,
  toggleConditionValue,
  withBaseConditions,
} from "./filter-tree";
import type { FilterNode } from "./model";

const priority = { key: "priority", operator: "in", values: ["high"] };
const assignee = { key: "assignee", operator: "in", values: ["me"] };

describe("filter tree", () => {
  it("adds a condition to an empty tree as a root and-group", () => {
    expect(setRootCondition(null, priority)).toEqual({
      op: "and",
      children: [priority],
    });
  });

  it("replaces the root condition of the same subject", () => {
    const root = setRootCondition(setRootCondition(null, priority), assignee);
    const next = setRootCondition(root, {
      key: "priority",
      operator: "notIn",
      values: ["low"],
    });
    expect(rootConditions(next)).toEqual([
      { key: "priority", operator: "notIn", values: ["low"] },
      assignee,
    ]);
  });

  it("keeps one condition per custom field", () => {
    const a = {
      key: "customField",
      operator: "in",
      values: ["x"],
      fieldId: "f1",
    };
    const b = {
      key: "customField",
      operator: "in",
      values: ["y"],
      fieldId: "f2",
    };
    const root = setRootCondition(setRootCondition(null, a), b);
    expect(countConditions(root)).toBe(2);
    expect(conditionId(a)).toBe("customField:f1");
    expect(findRootCondition(root, "customField", "f2")?.values).toEqual(["y"]);
    expect(
      rootConditions(removeRootCondition(root, "customField", "f1")),
    ).toEqual([b]);
  });

  it("removes the last condition to null", () => {
    expect(
      removeRootCondition(setRootCondition(null, priority), "priority"),
    ).toBe(null);
  });

  it("toggles values and drops an emptied condition", () => {
    let root = toggleConditionValue(null, "label", "l1");
    root = toggleConditionValue(root, "label", "l2");
    expect(findRootCondition(root, "label")?.values).toEqual(["l1", "l2"]);
    root = toggleConditionValue(root, "label", "l1");
    root = toggleConditionValue(root, "label", "l2");
    expect(root).toBe(null);
  });

  it("keeps the operator when values change", () => {
    const root = setRootCondition(null, {
      key: "priority",
      operator: "notIn",
      values: ["low"],
    });
    expect(
      findRootCondition(
        setConditionValues(root, "priority", ["high"]),
        "priority",
      )?.operator,
    ).toBe("notIn");
  });

  it("switches between match all and match any", () => {
    const root = setRootCondition(setRootCondition(null, priority), assignee);
    expect(rootOp(root)).toBe("and");
    expect(rootOp(setRootOp(root, "or"))).toBe("or");
    expect(setRootOp(null, "or")).toBe(null);
  });

  it("flags nested trees as read-only and counts every condition", () => {
    const nested: FilterNode = {
      op: "or",
      children: [priority, { op: "and", children: [assignee, priority] }],
    };
    expect(isNestedTree(nested)).toBe(true);
    expect(isNestedTree({ op: "and", children: [priority] })).toBe(false);
    expect(countConditions(nested)).toBe(3);
    expect(rootConditions(nested)).toEqual([priority]);
  });

  it("ands hidden base conditions without changing the tree", () => {
    const base = [{ key: "cycle", operator: "in", values: ["c1"] }];
    expect(withBaseConditions(null, base)).toEqual({
      op: "and",
      children: base,
    });
    const root = setRootCondition(null, priority);
    expect(withBaseConditions(root, base)).toEqual({
      op: "and",
      children: [...base, root],
    });
    expect(withBaseConditions(root, [])).toBe(root);
  });

  it("merges base conditions flat into a match-all tree", () => {
    const base = [assignee];
    const root = setRootCondition(null, priority);
    expect(mergeBaseConditions(root, base)).toEqual({
      op: "and",
      children: [assignee, priority],
    });
    const any = setRootOp(root, "or");
    expect(mergeBaseConditions(any, base)).toEqual({
      op: "and",
      children: [assignee, any],
    });
  });

  it("hashes and compares independently of key order", () => {
    const a = {
      op: "and",
      children: [{ key: "x", operator: "in", values: ["1"] }],
    };
    const b = {
      children: [{ values: ["1"], operator: "in", key: "x" }],
      op: "and",
    };
    expect(stableHash(a)).toBe(stableHash(b));
    expect(isSameValue(a, b)).toBe(true);
    expect(isSameValue(a, { ...a, op: "or" })).toBe(false);
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
  });
});
