import { HTTPException } from "hono/http-exception";
import { validateCustomFieldValue } from "../task/validate-task-fields";

// What editing a field definition may change, and what it does to values
// already saved. Pure, so the rules are unit-tested without a database.
//
// - The type and `required` are fixed once a field exists: changing them would
//   reinterpret values tasks already hold.
// - Renaming an option rewrites it everywhere it is stored (tasks, the default,
//   saved view filters, automation conditions, drafts). Renaming one option to
//   another listed option merges the two.
// - Removing an option changes no task. Tasks keep the value until someone
//   changes it, lists still group and sort by it, and it can't be newly set.
//   The Filter menu stops offering it (it lists the current options), while a
//   filter already set on it keeps matching, as filters compare stored text.

export type OptionRename = { from: string; to: string };

export type CustomFieldEdit = {
  name?: string;
  options?: string[];
  renamedOptions?: OptionRename[];
  defaultValue?: string | null;
};

type EditableField = {
  name: string;
  type: string;
  required: boolean;
  defaultValue: string | null;
  options: unknown;
};

export type CustomFieldEditPlan = {
  changes: {
    name?: string;
    options?: string[];
    defaultValue?: string | null;
  };
  /** Old option text to new, for the values already stored. */
  renames: Map<string, string>;
};

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

function currentOptions(field: EditableField): string[] {
  return Array.isArray(field.options) ? (field.options as string[]) : [];
}

function planOptions(
  field: EditableField,
  options: string[],
  renamed: OptionRename[],
): { options: string[]; renames: Map<string, string> } {
  if (field.type !== "dropdown") {
    badRequest("Only dropdown fields have options");
  }
  const next = options.map((option) => option.trim());
  if (next.length === 0 || next.some((option) => option.length === 0)) {
    badRequest("Dropdown fields must have at least one option");
  }
  if (new Set(next).size !== next.length) {
    badRequest("Dropdown options must be different from each other");
  }

  const known = currentOptions(field);
  const renames = new Map<string, string>();
  for (const { from, to } of renamed) {
    const target = to.trim();
    if (!known.includes(from)) {
      badRequest(`Unknown option to rename: ${from}`);
    }
    if (!next.includes(target)) {
      badRequest(`Renamed option is not in the new options: ${target}`);
    }
    if (renames.has(from)) badRequest(`Option renamed twice: ${from}`);
    if (from !== target) renames.set(from, target);
  }
  // A kept option can only also be a rename's source when a swap gives its
  // text to another option; otherwise its tasks would quietly move away.
  const targets = new Set(renames.values());
  for (const from of renames.keys()) {
    if (next.includes(from) && !targets.has(from)) {
      badRequest(`Option can't be both kept and renamed: ${from}`);
    }
  }
  return { options: next, renames };
}

function planDefault(
  field: EditableField,
  edit: CustomFieldEdit,
  options: string[],
  renames: ReadonlyMap<string, string>,
): string | null {
  const stored = field.defaultValue;
  const raw =
    edit.defaultValue !== undefined
      ? edit.defaultValue
      : stored !== null
        ? (renames.get(stored) ?? stored)
        : null;
  const value = raw?.trim() ? raw.trim() : null;

  if (value === null) {
    if (field.required) {
      badRequest("Required fields must have a default value");
    }
    return null;
  }
  if (field.type === "dropdown" && !options.includes(value)) {
    badRequest("Default value must be one of the dropdown options");
  }
  if (field.type === "number" || field.type === "date") {
    const error = validateCustomFieldValue(value, field.type, field.name);
    if (error) badRequest(error);
  }
  if (field.type === "boolean" && value !== "true" && value !== "false") {
    badRequest("Default value must be 'true' or 'false' for boolean fields");
  }
  return value;
}

export function planCustomFieldEdit(
  field: EditableField,
  edit: CustomFieldEdit,
): CustomFieldEditPlan {
  if (edit.renamedOptions?.length && !edit.options) {
    badRequest("Renaming options needs the full new options list");
  }
  const planned = edit.options
    ? planOptions(field, edit.options, edit.renamedOptions ?? [])
    : null;
  const renames = planned?.renames ?? new Map<string, string>();
  const options = planned?.options ?? currentOptions(field);

  const changes: CustomFieldEditPlan["changes"] = {};
  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (!name) badRequest("Give the field a name");
    changes.name = name;
  }
  if (planned) changes.options = planned.options;
  if (planned || edit.defaultValue !== undefined) {
    changes.defaultValue = planDefault(field, edit, options, renames);
  }
  return { changes, renames };
}

/** The filter tree with a field's renamed options; null when nothing changed. */
export function renameInViewFilters(
  filters: unknown,
  fieldId: string,
  renames: ReadonlyMap<string, string>,
): unknown | null {
  let changed = false;
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.children)) {
      return { ...record, children: record.children.map(visit) };
    }
    if (
      record.key !== "customField" ||
      record.fieldId !== fieldId ||
      !Array.isArray(record.values)
    ) {
      return node;
    }
    const values = record.values.map((value) => {
      // `none` is the filter's "no value" token, never an option's text.
      const next = value === "none" ? undefined : renames.get(value as string);
      if (next === undefined) return value;
      changed = true;
      return next;
    });
    return { ...record, values: [...new Set(values)] };
  };
  const root = (filters as { root?: unknown } | null)?.root;
  const next = visit(root);
  return changed ? { ...(filters as object), root: next } : null;
}

/** Automation conditions with a field's renames; null when nothing changed. */
export function renameInRuleConditions(
  conditions: unknown,
  fieldId: string,
  renames: ReadonlyMap<string, string>,
): Record<string, unknown> | null {
  let changed = false;
  const visit = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return node;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.conditions)) {
      return { ...record, conditions: record.conditions.map(visit) };
    }
    if (record.field !== "custom_field" || record.fieldId !== fieldId) {
      return node;
    }
    const next = renames.get(record.value as string);
    if (next === undefined) return node;
    changed = true;
    return { ...record, value: next };
  };
  const result = visit(conditions);
  return changed ? (result as Record<string, unknown>) : null;
}

/** Draft values with a field's renames; null when nothing changed. */
export function renameInDraftValues(
  values: readonly { fieldId: string; value: string }[],
  fieldId: string,
  renames: ReadonlyMap<string, string>,
): { fieldId: string; value: string }[] | null {
  let changed = false;
  const result = values.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const next = renames.get(entry.value);
    if (next === undefined) return entry;
    changed = true;
    return { ...entry, value: next };
  });
  return changed ? result : null;
}
