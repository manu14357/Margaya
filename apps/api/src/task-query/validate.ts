import { HTTPException } from "hono/http-exception";
import {
  DATE_PRESETS,
  isValidDay,
  ROLLING_OPERATORS,
  type RollingOperator,
} from "./dates";
import { type FilterKeyRegistry, filterKeyRegistry } from "./keys";
import {
  type FilterCondition,
  type FilterNode,
  isFilterGroup,
  MAX_CONDITION_VALUES,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_DEPTH,
  MAX_GROUP_CHILDREN,
  MAX_VALUE_LENGTH,
} from "./schema";

// Context-free checks of a filter tree: known keys, valid operators with
// exactly their fields, limits and dates. Saved views run the same checks
// before storing a tree, so anything stored can run.

export const SET_OPERATORS = ["in", "notIn"] as const;
export const DATE_OPERATORS = [
  "on",
  "onOrBefore",
  "onOrAfter",
  "between",
  ...ROLLING_OPERATORS,
  "in",
  "empty",
  "notEmpty",
] as const;

export const MAX_ROLLING_AMOUNT = 365;

const CONDITION_FIELDS = [
  "values",
  "date",
  "from",
  "to",
  "amount",
  "unit",
  "fieldId",
] as const satisfies readonly (keyof FilterCondition)[];

type ConditionField = (typeof CONDITION_FIELDS)[number];

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function tooComplex(reason: string): never {
  badRequest(`Filters are too complex: ${reason}`);
}

export function unsupportedFilter(key: string): never {
  badRequest(`Unsupported filter: ${key}`);
}

function isRollingOperator(operator: string): operator is RollingOperator {
  return (ROLLING_OPERATORS as readonly string[]).includes(operator);
}

/** The fields an operator needs, or null when the operator is unknown. */
function operatorFields(
  kind: "set" | "date",
  operator: string,
): ConditionField[] | null {
  if (kind === "set") {
    return operator === "in" || operator === "notIn" ? ["values"] : null;
  }
  if (
    operator === "on" ||
    operator === "onOrBefore" ||
    operator === "onOrAfter"
  )
    return ["date"];
  if (operator === "between") return ["from", "to"];
  if (isRollingOperator(operator)) return ["amount", "unit"];
  if (operator === "in") return ["values"];
  if (operator === "empty" || operator === "notEmpty") return [];
  return null;
}

function assertDay(value: string | undefined): string {
  if (value === undefined || !isValidDay(value)) badRequest("Invalid date");
  return value;
}

function validateCondition(
  condition: FilterCondition,
  registry: FilterKeyRegistry,
): void {
  const descriptor = registry.get(condition.key);
  if (!descriptor) unsupportedFilter(condition.key);
  const invalidOperator = (): never =>
    badRequest(
      `Operator ${condition.operator} is not valid for ${condition.key}`,
    );

  const needed = new Set(
    operatorFields(descriptor.kind, condition.operator) ?? invalidOperator(),
  );
  if (descriptor.kind === "set" && descriptor.needsFieldId) {
    needed.add("fieldId");
  }
  for (const field of CONDITION_FIELDS) {
    if ((condition[field] !== undefined) !== needed.has(field)) {
      invalidOperator();
    }
  }

  const values = condition.values;
  if (values) {
    if (values.length === 0) invalidOperator();
    if (values.length > MAX_CONDITION_VALUES) {
      tooComplex(`a condition has more than ${MAX_CONDITION_VALUES} values`);
    }
    if (values.some((value) => value.length > MAX_VALUE_LENGTH)) {
      tooComplex(`a value is longer than ${MAX_VALUE_LENGTH} characters`);
    }
    if (values.some((value) => value.length === 0)) {
      badRequest(`Unsupported value for ${condition.key}: ""`);
    }
  }

  if (descriptor.kind === "set") {
    if (descriptor.values && values) {
      const allowed = new Set<string>([
        ...descriptor.values,
        ...(descriptor.tokens ?? []),
        "none",
      ]);
      const unknown = values.find((value) => !allowed.has(value));
      if (unknown !== undefined) {
        badRequest(`Unsupported value for ${condition.key}: ${unknown}`);
      }
    }
    return;
  }

  const operator = condition.operator;
  if (
    operator === "on" ||
    operator === "onOrBefore" ||
    operator === "onOrAfter"
  ) {
    assertDay(condition.date);
  } else if (operator === "between") {
    const from = assertDay(condition.from);
    const to = assertDay(condition.to);
    if (from > to) badRequest("Invalid date range");
  } else if (isRollingOperator(operator)) {
    const amount = condition.amount ?? 0;
    if (
      !Number.isInteger(amount) ||
      amount < 1 ||
      amount > MAX_ROLLING_AMOUNT
    ) {
      badRequest(
        `Invalid amount for ${condition.key}: use 1 to ${MAX_ROLLING_AMOUNT}`,
      );
    }
  } else if (operator === "in") {
    const unknown = values?.find(
      (value) => !(DATE_PRESETS as readonly string[]).includes(value),
    );
    if (unknown !== undefined) {
      badRequest(`Unsupported value for ${condition.key}: ${unknown}`);
    }
  }
}

/**
 * Throws a 400 with the engine's message when the tree cannot run: an
 * unknown key, a bad operator, a limit (depth 3, 20 children, 50 conditions,
 * 100 values of 128 characters) or a bad date.
 */
export function validateFilterTree(
  root: FilterNode | null | undefined,
  registry: FilterKeyRegistry = filterKeyRegistry,
): void {
  if (!root) return;
  let conditions = 0;
  const visit = (node: FilterNode, depth: number) => {
    if (isFilterGroup(node)) {
      if (depth > MAX_FILTER_DEPTH) {
        tooComplex(`groups nest deeper than ${MAX_FILTER_DEPTH} levels`);
      }
      if (
        node.children.length === 0 ||
        node.children.length > MAX_GROUP_CHILDREN
      ) {
        tooComplex(`a group needs 1 to ${MAX_GROUP_CHILDREN} filters`);
      }
      for (const child of node.children) visit(child, depth + 1);
      return;
    }
    conditions += 1;
    if (conditions > MAX_FILTER_CONDITIONS) {
      tooComplex(`more than ${MAX_FILTER_CONDITIONS} conditions`);
    }
    validateCondition(node, registry);
  };
  visit(root, 1);
}

/** Every condition of a tree, depth first. */
export function filterConditions(
  root: FilterNode | null | undefined,
): FilterCondition[] {
  if (!root) return [];
  if (!isFilterGroup(root)) return [root];
  return root.children.flatMap((child) => filterConditions(child));
}
