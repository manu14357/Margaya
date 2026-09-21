import {
  type FilterCondition,
  type FilterGroupOp,
  type FilterNode,
  isFilterGroup,
} from "./model";

// Pure helpers over filter trees. The toolbar edits one level: a root group
// of conditions joined by "all" (and) or "any" (or), one condition per
// subject. Deeper trees (the API accepts three levels) are shown read-only.

/** A condition's subject: its key, plus the field of a custom field. */
export function conditionId(
  condition: Pick<FilterCondition, "key" | "fieldId">,
) {
  return condition.fieldId
    ? `${condition.key}:${condition.fieldId}`
    : condition.key;
}

/** True when the tree has groups inside the root group. */
export function isNestedTree(root: FilterNode | null | undefined): boolean {
  if (!root || !isFilterGroup(root)) return false;
  return root.children.some((child) => isFilterGroup(child));
}

/** The root's conditions (none for a nested tree's groups). */
export function rootConditions(
  root: FilterNode | null | undefined,
): FilterCondition[] {
  if (!root) return [];
  if (!isFilterGroup(root)) return [root];
  return root.children.filter(
    (child): child is FilterCondition => !isFilterGroup(child),
  );
}

/** Every condition in the tree, depth first. */
export function allConditions(
  root: FilterNode | null | undefined,
): FilterCondition[] {
  if (!root) return [];
  if (!isFilterGroup(root)) return [root];
  return root.children.flatMap((child) => allConditions(child));
}

export function countConditions(root: FilterNode | null | undefined): number {
  return allConditions(root).length;
}

export function rootOp(root: FilterNode | null | undefined): FilterGroupOp {
  return root && isFilterGroup(root) ? root.op : "and";
}

function fromConditions(
  op: FilterGroupOp,
  conditions: FilterCondition[],
): FilterNode | null {
  if (conditions.length === 0) return null;
  return { op, children: conditions };
}

export function findRootCondition(
  root: FilterNode | null | undefined,
  key: string,
  fieldId?: string,
): FilterCondition | undefined {
  const id = conditionId({ key, fieldId });
  return rootConditions(root).find(
    (condition) => conditionId(condition) === id,
  );
}

/** Adds the condition, or replaces the root condition of the same subject. */
export function setRootCondition(
  root: FilterNode | null | undefined,
  condition: FilterCondition,
): FilterNode | null {
  const id = conditionId(condition);
  const conditions = rootConditions(root);
  const index = conditions.findIndex(
    (existing) => conditionId(existing) === id,
  );
  const next =
    index === -1
      ? [...conditions, condition]
      : conditions.map((existing, i) => (i === index ? condition : existing));
  return fromConditions(rootOp(root), next);
}

/** Removes the root condition of a subject; an empty tree becomes null. */
export function removeRootCondition(
  root: FilterNode | null | undefined,
  key: string,
  fieldId?: string,
): FilterNode | null {
  const id = conditionId({ key, fieldId });
  return fromConditions(
    rootOp(root),
    rootConditions(root).filter((condition) => conditionId(condition) !== id),
  );
}

/** Switches the root group between "match all" and "match any". */
export function setRootOp(
  root: FilterNode | null | undefined,
  op: FilterGroupOp,
): FilterNode | null {
  if (!root) return null;
  if (!isFilterGroup(root)) return { op, children: [root] };
  return { ...root, op };
}

/**
 * Toggles one value of a set condition (operator kept, `in` when new). The
 * condition goes away when its last value is removed.
 */
export function toggleConditionValue(
  root: FilterNode | null | undefined,
  key: string,
  value: string,
  fieldId?: string,
): FilterNode | null {
  const existing = findRootCondition(root, key, fieldId);
  const values = existing?.values ?? [];
  const nextValues = values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
  if (nextValues.length === 0) return removeRootCondition(root, key, fieldId);
  return setRootCondition(root, {
    key,
    operator: existing?.operator ?? "in",
    values: nextValues,
    ...(fieldId ? { fieldId } : {}),
  });
}

/** Sets a set condition's values; an empty list removes it. */
export function setConditionValues(
  root: FilterNode | null | undefined,
  key: string,
  values: string[],
  fieldId?: string,
): FilterNode | null {
  if (values.length === 0) return removeRootCondition(root, key, fieldId);
  const existing = findRootCondition(root, key, fieldId);
  return setRootCondition(root, {
    key,
    operator: existing?.operator ?? "in",
    values,
    ...(fieldId ? { fieldId } : {}),
  });
}

/**
 * ANDs hidden base conditions (a cycle page's own cycle, "assigned to me")
 * with the user's tree. They never show as chips.
 */
export function withBaseConditions(
  root: FilterNode | null | undefined,
  base: readonly FilterCondition[],
): FilterNode | null {
  if (base.length === 0) return root ?? null;
  if (!root) return { op: "and", children: [...base] };
  return { op: "and", children: [...base, root] };
}

/**
 * Base conditions made part of the tree (a built-in view saved as a view):
 * flat while the root matches all, so the chips stay editable.
 */
export function mergeBaseConditions(
  root: FilterNode | null | undefined,
  base: readonly FilterCondition[],
): FilterNode | null {
  if (base.length === 0) return root ?? null;
  if (!root) return { op: "and", children: [...base] };
  if (!isFilterGroup(root)) return { op: "and", children: [...base, root] };
  if (root.op === "and" && !isNestedTree(root)) {
    return { op: "and", children: [...base, ...root.children] };
  }
  return { op: "and", children: [...base, root] };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** A stable string for any JSON value: object key order doesn't matter. */
export function stableHash(value: unknown): string {
  return JSON.stringify(sortKeys(value ?? null));
}

export function isSameValue(a: unknown, b: unknown): boolean {
  return stableHash(a) === stableHash(b);
}
