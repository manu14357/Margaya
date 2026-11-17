import { markdownToJson } from "@margaya/editor-schema";
import { BOARD_TEMPLATE_IDS } from "@margaya/whiteboard";
import { createAutomationRuleBody } from "../automation-rule/schema";
import { unknownTemplateVariables } from "../automation-rule/vocabulary";
import { createColumnBody } from "../column/schema";
import {
  createCustomFieldBody,
  updateCustomFieldBody,
} from "../custom-field/schema";
import { createCycleBody } from "../cycle/schema";
import { createEstimateBody } from "../estimate/schema";
import { validateEstimateValues } from "../estimate/validate-points";
import {
  MAX_FORM_CONFIRMATION,
  MAX_FORM_CUSTOM_FIELDS,
  MAX_FORM_INTRO,
  MAX_FORM_TITLE,
} from "../intake-form/service";
import { createModuleBody } from "../module/schema";
import { MODULE_STATUSES } from "../module/types";
import { buildPageContent } from "../page/content";
import { PAGE_ICON_NAMES } from "../page/icons";
import { isSingleEmoji } from "../page/rules";
import { createPageBody } from "../page/schema";
import { PAGE_LIMITS } from "../page/types";
import { PROJECT_FEATURE_KEYS } from "../project/features";
import {
  VALID_PRIORITIES,
  VIRTUAL_STATUSES,
} from "../task/validate-task-fields";
import { setTaskRecurrenceBody } from "../task-recurrence/schema";
import { createTemplateBody } from "../task-template/schema";
import { isValidDateString } from "../utils/calendar-date";
import { createViewBody } from "../view/schema";
import {
  assertViewDisplay,
  assertViewDisplayProperties,
  assertViewFilters,
} from "../view/validate";
import { createWhiteboardBody } from "../whiteboard/schema";
import {
  buildIntakeForm,
  buildPages,
  buildPageTemplates,
  buildRule,
  buildTaskTemplates,
  buildView,
  placeholderRefs,
  planSampleData,
  ruleLabelKeys,
  sectionsMarkdown,
} from "./build";
import { resolveTemplate, textKeysOf } from "./resolve";
import { APP_LOCALES, type TextSource } from "./text";
import {
  CATEGORY_IDS,
  LABEL_COLORS,
  type ProjectTemplate,
  type TemplateCondition,
  type TemplateFilterNode,
  type TemplateGroupBy,
  type TemplateOrderField,
} from "./types";

// The template checker: every rule a definition must pass before it ships,
// in every locale, through the real request schemas and validators. Used by
// scripts/check-template.ts and the unit test over every registered
// template.

export type TemplateIssue = {
  severity: "error" | "warning";
  /** The locale the issue was found in; absent for structural issues. */
  locale?: string;
  /** Where in the definition, e.g. "views[2].filters". */
  path: string;
  message: string;
};

const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PROJECT_KEY_PATTERN = /^[A-Z0-9]{2,5}$/;
const MAX_SAMPLE_TASKS = 25;
const MAX_SAMPLE_CYCLES = 2;
const MAX_TASK_TEMPLATES = 50;
const MAX_RULES = 100;
const MAX_LABEL_NAME = 50;
const DISCOURAGED_ORDER_FIELDS = new Set(["voteScore", "archivedAt"]);
const COMMON_PREFIX = "projectTemplates:common.";

function zodMessage(error: {
  issues: { path: PropertyKey[]; message: string }[];
}) {
  const issue = error.issues[0];
  if (!issue) return "invalid";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

/** Every condition of a template filter tree, with its depth. */
function filterConditions(
  node: TemplateFilterNode | null | undefined,
  depth = 1,
): { condition: Exclude<TemplateFilterNode, { op: string }>; depth: number }[] {
  if (!node) return [];
  if ("op" in node) {
    return node.children.flatMap((child) => filterConditions(child, depth + 1));
  }
  return [{ condition: node, depth }];
}

function ruleConditions(
  rule: NonNullable<ProjectTemplate["automationRules"]>[number],
): TemplateCondition[] {
  return (rule.conditions?.conditions ?? []).flatMap((item) =>
    "conditions" in item ? [...item.conditions] : [item],
  );
}

/**
 * Checks a definition in every locale. `source` is the text the server
 * would use (i18n plus locale fragments). Returns errors and warnings;
 * a template ships only with no errors.
 */
export function validateTemplate(
  definition: ProjectTemplate,
  source: TextSource,
  { locales = APP_LOCALES }: { locales?: readonly string[] } = {},
): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const error = (path: string, message: string, locale?: string) =>
    issues.push({
      severity: "error",
      path,
      message,
      ...(locale ? { locale } : {}),
    });
  const warn = (path: string, message: string) =>
    issues.push({ severity: "warning", path, message });

  checkStructure(definition, error, warn);
  const structuralErrors = issues.some((issue) => issue.severity === "error");

  const englishVariables = new Map<string, string>();
  for (const locale of locales) {
    let resolved: ReturnType<typeof resolveTemplate>;
    try {
      resolved = resolveTemplate(definition, locale, source, { strict: true });
    } catch (caught) {
      error("text", errorMessage(caught), locale);
      continue;
    }
    for (const key of resolved.missing) {
      error("text", `missing text for ${key}`, locale);
    }
    if (resolved.missing.length > 0) continue;
    // Structural errors make the per-locale checks noisy and unreliable.
    if (structuralErrors) continue;
    checkLocale(definition, resolved, locale, error);

    // Rule texts must keep the same {{variables}} as en-US.
    for (const key of textKeysOf(definition)) {
      const text = resolved.t(key);
      const variables = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)]
        .map((match) => match[1])
        .sort()
        .join(",");
      if (locale === "en-US") englishVariables.set(key, variables);
      else if (
        englishVariables.has(key) &&
        englishVariables.get(key) !== variables
      ) {
        error(
          "text",
          `${key} uses {{${variables}}}, en-US uses {{${englishVariables.get(key)}}}`,
          locale,
        );
      }
    }
  }
  return issues;
}

type Report = (path: string, message: string, locale?: string) => void;

function checkStructure(
  definition: ProjectTemplate,
  error: Report,
  warn: (path: string, message: string) => void,
) {
  const id = definition.id;
  if (!ID_PATTERN.test(id)) error("id", `"${id}" is not kebab-case`);
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    error("version", "must be a positive integer");
  }
  if (definition.categories.length === 0) error("categories", "at least one");
  for (const category of definition.categories) {
    if (!(CATEGORY_IDS as readonly string[]).includes(category)) {
      error("categories", `unknown category "${category}"`);
    }
  }
  if (duplicates(definition.categories).length > 0) {
    error("categories", "listed twice");
  }
  if (!PAGE_ICON_NAMES.has(definition.icon)) {
    error("icon", `"${definition.icon}" is not a project icon name`);
  }
  for (const part of ["name", "pitch", "description"] as const) {
    const expected = `projectTemplates:catalog.${id}.${part}`;
    if (definition[part] !== expected) error(part, `must be "${expected}"`);
  }
  if (!PROJECT_KEY_PATTERN.test(definition.suggestedKey)) {
    error("suggestedKey", "2-5 characters of A-Z and 0-9");
  }

  // Text keys: shared vocabulary or this template's own namespace.
  for (const key of textKeysOf(definition)) {
    if (key.startsWith("whiteboards:")) continue;
    const own =
      key.startsWith(`projectTemplates:catalog.${id}.`) ||
      key.startsWith(`projectTemplates:content.${id}.`) ||
      key.startsWith(COMMON_PREFIX);
    if (!own) {
      error(
        "text",
        `${key}: use projectTemplates:common.*, catalog.${id}.* or content.${id}.*`,
      );
    }
  }

  // Features: all ten stated.
  const features = definition.project.features as Record<string, unknown>;
  for (const feature of PROJECT_FEATURE_KEYS) {
    if (typeof features[feature] !== "boolean") {
      error(
        "project.features",
        `state "${feature}" explicitly (true or false)`,
      );
    }
  }
  for (const key of Object.keys(features)) {
    if (!(PROJECT_FEATURE_KEYS as readonly string[]).includes(key)) {
      error("project.features", `unknown feature "${key}"`);
    }
  }
  const on = (feature: (typeof PROJECT_FEATURE_KEYS)[number]) =>
    features[feature] === true;
  const needs = (
    present: boolean,
    feature: (typeof PROJECT_FEATURE_KEYS)[number],
    what: string,
  ) => {
    if (present && !on(feature)) {
      error("project.features", `${what} needs "${feature}" on`);
    }
  };
  needs(Boolean(definition.views?.length), "views", "views");
  needs(Boolean(definition.estimate), "estimates", "an estimate system");
  needs(Boolean(definition.modules?.length), "modules", "modules");
  needs(Boolean(definition.intakeForm), "intake", "a request form");
  needs(Boolean(definition.updateReminder), "updates", "an update reminder");
  needs(Boolean(definition.pages?.length), "pages", "pages");
  needs(Boolean(definition.pageTemplates?.length), "pages", "page templates");
  needs(Boolean(definition.whiteboards?.length), "whiteboards", "whiteboards");
  needs(Boolean(definition.sample?.cycles?.length), "cycles", "sample cycles");
  needs(
    Boolean(definition.scheduledAutomations?.cycleRollover?.enabled),
    "cycles",
    "cycle rollover",
  );

  // Template-local keys.
  const keysOf = (kind: string, keys: readonly string[]) => {
    for (const key of keys) {
      if (!KEY_PATTERN.test(key))
        error(kind, `key "${key}" must match [a-z][a-z0-9-]*`);
    }
    for (const key of duplicates(keys))
      error(kind, `key "${key}" is used twice`);
    return new Set(keys);
  };
  const columns = keysOf(
    "columns",
    definition.columns.map((c) => c.key),
  );
  const labels = keysOf(
    "labels",
    (definition.labels ?? []).map((l) => l.key),
  );
  const fields = keysOf(
    "customFields",
    (definition.customFields ?? []).map((f) => f.key),
  );
  const modules = keysOf(
    "modules",
    (definition.modules ?? []).map((m) => m.key),
  );
  const pages = keysOf(
    "pages",
    (definition.pages ?? []).map((p) => p.key),
  );
  const samples = keysOf(
    "sample.tasks",
    (definition.sample?.tasks ?? []).map((t) => t.key),
  );
  const columnGroup = new Map(definition.columns.map((c) => [c.key, c.group]));
  const fieldDef = new Map(
    (definition.customFields ?? []).map((field) => [field.key, field]),
  );
  const estimateValues = new Set(definition.estimate?.values ?? []);
  const ref = (path: string, kind: string, set: Set<string>, key: string) => {
    if (!set.has(key)) error(path, `unknown ${kind} "${key}"`);
  };
  const priorities = VALID_PRIORITIES as readonly string[];

  // Columns.
  const groups = definition.columns.map((column) => column.group);
  if (
    !groups.some((g) => g === "backlog" || g === "unstarted" || g === "started")
  ) {
    error(
      "columns",
      "needs at least one open column (backlog, unstarted or started)",
    );
  }
  if (!groups.includes("completed"))
    error("columns", "needs a completed column");
  definition.columns.forEach((column, index) => {
    const parsed = createColumnBody.safeParse({
      name: "check",
      group: column.group,
      ...(column.icon ? { icon: column.icon } : {}),
      ...(column.color ? { color: column.color } : {}),
    });
    if (!parsed.success) error(`columns[${index}]`, zodMessage(parsed.error));
  });

  // Labels.
  if ((definition.labels?.length ?? 0) > 5) {
    warn("labels", "labels are workspace-wide; keep to 2-5");
  }
  (definition.labels ?? []).forEach((label, index) => {
    if (!(LABEL_COLORS as readonly string[]).includes(label.color)) {
      error(
        `labels[${index}]`,
        `colour "${label.color}" is not in the palette`,
      );
    }
  });

  // Custom fields.
  if ((definition.customFields?.length ?? 0) > 5) {
    warn("customFields", "keep to 0-5 custom fields");
  }
  (definition.customFields ?? []).forEach((field, index) => {
    const path = `customFields[${index}]`;
    if (field.type === "dropdown") {
      if (field.options.length < 1 || field.options.length > 200) {
        error(path, "a dropdown needs 1-200 options");
      }
      const optionKeys = keysOf(
        `${path}.options`,
        field.options.map((o) => o.key),
      );
      if (
        field.defaultOption !== undefined &&
        !optionKeys.has(field.defaultOption)
      ) {
        error(
          path,
          `defaultOption "${field.defaultOption}" is not an option key`,
        );
      }
      if (field.required && field.defaultOption === undefined) {
        error(path, "a required field needs a defaultOption");
      }
    } else {
      if (field.required && field.defaultValue === undefined) {
        error(path, "a required field needs a defaultValue");
      }
      const value = field.defaultValue;
      if (value !== undefined) {
        if (field.type === "number" && !Number.isFinite(Number(value))) {
          error(path, "defaultValue must be a number");
        }
        if (field.type === "date" && !isValidDateString(value)) {
          error(path, "defaultValue must be YYYY-MM-DD");
        }
        if (field.type === "boolean" && value !== "true" && value !== "false") {
          error(path, 'defaultValue must be "true" or "false"');
        }
      }
    }
  });

  // Estimate.
  if (definition.estimate) {
    const { type, values } = definition.estimate;
    values.forEach((value, index) => {
      const isKey = value.startsWith("projectTemplates:");
      if (type === "categories" && !isKey) {
        error(`estimate.values[${index}]`, "category values are TextKeys");
      }
      if (type !== "categories" && isKey) {
        error(
          `estimate.values[${index}]`,
          `${type} values are numbers as text, not translated`,
        );
      }
    });
    if (duplicates(values).length > 0)
      error("estimate.values", "duplicate values");
  }

  // Modules.
  (definition.modules ?? []).forEach((module, index) => {
    if (
      module.status &&
      !(MODULE_STATUSES as readonly string[]).includes(module.status)
    ) {
      error(`modules[${index}]`, `unknown status "${module.status}"`);
    }
  });

  // Task templates.
  const templates = definition.taskTemplates ?? [];
  if (templates.length > MAX_TASK_TEMPLATES) {
    error("taskTemplates", `at most ${MAX_TASK_TEMPLATES}`);
  }
  templates.forEach((template, index) => {
    const path = `taskTemplates[${index}]`;
    if (template.column) ref(path, "column", columns, template.column);
    for (const label of template.labels ?? [])
      ref(path, "label", labels, label);
    if (
      template.estimateValue !== undefined &&
      !estimateValues.has(template.estimateValue)
    ) {
      error(
        path,
        `estimateValue "${template.estimateValue}" is not an estimate value`,
      );
    }
    if (template.priority && !priorities.includes(template.priority)) {
      error(path, `unknown priority "${template.priority}"`);
    }
  });

  // Views.
  const checkGroupKey = (
    path: string,
    key: TemplateGroupBy | null | undefined,
  ) => {
    if (key && typeof key === "object")
      ref(path, "custom field", fields, key.customField);
  };
  const checkOrderField = (path: string, field: TemplateOrderField) => {
    if (typeof field === "object")
      ref(path, "custom field", fields, field.customField);
    else if (DISCOURAGED_ORDER_FIELDS.has(field)) {
      error(path, `ordering by "${field}" makes no sense in a new project`);
    }
  };
  (definition.views ?? []).forEach((view, index) => {
    const path = `views[${index}]`;
    for (const { condition } of filterConditions(view.filters?.root)) {
      const at = `${path}.filters`;
      switch (condition.key) {
        case "status":
          for (const key of condition.columns) ref(at, "column", columns, key);
          break;
        case "label":
          for (const key of condition.labels) ref(at, "label", labels, key);
          break;
        case "module":
          for (const key of condition.modules) ref(at, "module", modules, key);
          break;
        case "customField": {
          ref(at, "custom field", fields, condition.field);
          const field = fieldDef.get(condition.field);
          if (field?.type === "dropdown") {
            const keys = new Set(field.options.map((o) => o.key));
            for (const option of condition.options) {
              if (option !== "none" && !keys.has(option)) {
                error(
                  at,
                  `"${option}" is not an option key of ${condition.field}`,
                );
              }
            }
          }
          break;
        }
        default:
          if ("amount" in condition) {
            if (
              !Number.isInteger(condition.amount) ||
              condition.amount < 1 ||
              condition.amount > 365
            ) {
              error(at, "amount must be a whole number from 1 to 365");
            }
          }
      }
    }
    checkGroupKey(`${path}.display.groupBy`, view.display?.groupBy);
    checkGroupKey(`${path}.display.subGroupBy`, view.display?.subGroupBy);
    if (view.display?.orderBy) {
      checkOrderField(`${path}.display.orderBy`, view.display.orderBy.field);
    }
    for (const key of view.displayProperties?.customFields ?? []) {
      ref(`${path}.displayProperties`, "custom field", fields, key);
    }
  });

  // Automation rules.
  const rules = definition.automationRules ?? [];
  if (rules.length > MAX_RULES)
    error("automationRules", `at most ${MAX_RULES}`);
  rules.forEach((rule, index) => {
    const path = `automationRules[${index}]`;
    const trigger = rule.trigger;
    if (trigger.type === "status_changed") {
      for (const key of [...(trigger.from ?? []), ...(trigger.to ?? [])]) {
        ref(path, "column", columns, key);
      }
    }
    if (trigger.type === "moved_to_module") {
      for (const key of trigger.modules ?? [])
        ref(path, "module", modules, key);
      if (!on("modules")) error(path, 'moved_to_module needs "modules" on');
    }
    for (const key of ruleLabelKeys(rule)) ref(path, "label", labels, key);
    for (const condition of ruleConditions(rule)) {
      if (condition.field === "status") {
        for (const key of condition.columns) ref(path, "column", columns, key);
      }
      if (condition.field === "custom_field") {
        ref(path, "custom field", fields, condition.fieldKey);
        const field = fieldDef.get(condition.fieldKey);
        if (
          field?.type === "dropdown" &&
          !field.options.some((option) => option.key === condition.value)
        ) {
          error(
            path,
            `"${condition.value}" is not an option key of ${condition.fieldKey}`,
          );
        }
      }
      if (condition.field === "estimate" && !on("estimates")) {
        error(path, 'an estimate condition needs "estimates" on');
      }
    }
    for (const action of rule.actions) {
      if (action.type === "set_status")
        ref(path, "column", columns, action.column);
      if (action.type === "move_to_module") {
        ref(path, "module", modules, action.module);
      }
      if (action.type === "notify" && action.roles.length === 0) {
        error(path, "notify needs at least one role");
      }
      if (
        action.type === "set_due_date" &&
        (!Number.isInteger(action.offsetDays) ||
          action.offsetDays < 0 ||
          action.offsetDays > 365)
      ) {
        error(path, "offsetDays must be a whole number from 0 to 365");
      }
    }
  });

  // Scheduled automations.
  const scheduled = definition.scheduledAutomations;
  for (const part of ["autoArchive", "autoClose"] as const) {
    const months = scheduled?.[part]?.months;
    if (
      months !== undefined &&
      (!Number.isInteger(months) || months < 1 || months > 12)
    ) {
      error(`scheduledAutomations.${part}`, "months must be 1-12");
    }
  }
  if (scheduled?.autoClose?.enabled) {
    const column = scheduled.autoClose.column;
    if (!column)
      error("scheduledAutomations.autoClose", "needs a cancelled column");
    else if (columnGroup.get(column) !== "cancelled") {
      error(
        "scheduledAutomations.autoClose",
        `"${column}" is not a cancelled column`,
      );
    }
  }

  // Request form.
  const form = definition.intakeForm;
  if (form) {
    if ((form.customFields?.length ?? 0) > MAX_FORM_CUSTOM_FIELDS) {
      error("intakeForm.customFields", `at most ${MAX_FORM_CUSTOM_FIELDS}`);
    }
    for (const key of form.customFields ?? []) {
      ref("intakeForm.customFields", "custom field", fields, key);
    }
  }

  // Update reminder.
  const weekday = definition.updateReminder?.weekday;
  if (weekday !== undefined && (weekday < 0 || weekday > 6)) {
    error("updateReminder.weekday", "0 (Sunday) to 6 (Saturday)");
  }

  // Pages.
  const parentOf = new Map(
    (definition.pages ?? []).map((page) => [page.key, page.parent ?? null]),
  );
  const logoOk = (
    path: string,
    logo: { kind: string; value: string } | undefined,
  ) => {
    if (!logo) return;
    if (
      logo.kind === "emoji"
        ? !isSingleEmoji(logo.value)
        : !PAGE_ICON_NAMES.has(logo.value)
    ) {
      error(path, `invalid ${logo.kind} logo "${logo.value}"`);
    }
  };
  (definition.pages ?? []).forEach((page, index) => {
    const path = `pages[${index}]`;
    logoOk(path, page.logo);
    if (page.parent) ref(path, "page", pages, page.parent);
    let depth = 1;
    let current = page.parent ?? null;
    const seen = new Set([page.key]);
    while (current) {
      if (seen.has(current)) {
        error(path, "parent chain loops");
        break;
      }
      seen.add(current);
      depth += 1;
      current = parentOf.get(current) ?? null;
    }
    if (depth > PAGE_LIMITS.depth)
      error(path, `nested deeper than ${PAGE_LIMITS.depth}`);
    if (page.sections.length === 0) error(path, "needs at least one section");
  });
  (definition.pageTemplates ?? []).forEach((template, index) => {
    logoOk(`pageTemplates[${index}]`, template.logo);
  });

  // Whiteboards.
  (definition.whiteboards ?? []).forEach((board, index) => {
    const path = `whiteboards[${index}]`;
    if (!(BOARD_TEMPLATE_IDS as readonly string[]).includes(board.board)) {
      error(path, `unknown board layout "${board.board}"`);
    }
    if (board.icon !== undefined && !isSingleEmoji(board.icon)) {
      error(path, "icon must be one emoji");
    }
  });

  // Sample data.
  const sample = definition.sample;
  if (sample) {
    const total = sample.tasks.reduce(
      (sum, task) => sum + 1 + (task.subtasks?.length ?? 0),
      0,
    );
    if (total > MAX_SAMPLE_TASKS) {
      error(
        "sample.tasks",
        `${total} tasks; at most ${MAX_SAMPLE_TASKS} including sub-tasks`,
      );
    }
    const cycles = sample.cycles ?? [];
    if (cycles.length > MAX_SAMPLE_CYCLES)
      error("sample.cycles", `at most ${MAX_SAMPLE_CYCLES}`);
    const spans = cycles.map((cycle, index) => {
      if (
        !Number.isInteger(cycle.lengthDays) ||
        cycle.lengthDays < 1 ||
        cycle.lengthDays > 60
      ) {
        error(`sample.cycles[${index}]`, "lengthDays must be 1-60");
      }
      if (
        !Number.isInteger(cycle.startInDays) ||
        Math.abs(cycle.startInDays) > 365
      ) {
        error(
          `sample.cycles[${index}]`,
          "startInDays must be a whole number within 365",
        );
      }
      return [
        cycle.startInDays,
        cycle.startInDays + cycle.lengthDays - 1,
      ] as const;
    });
    spans.forEach(([start, end], index) => {
      spans.slice(index + 1).forEach(([otherStart, otherEnd]) => {
        if (start <= otherEnd && otherStart <= end) {
          error("sample.cycles", "cycles overlap");
        }
      });
    });
    const blocks = new Map<string, string[]>();
    let recurring = 0;
    sample.tasks.forEach((task, index) => {
      const path = `sample.tasks[${index}]`;
      ref(path, "column", columns, task.column);
      for (const label of task.labels ?? []) ref(path, "label", labels, label);
      if (task.priority && !priorities.includes(task.priority)) {
        error(path, `unknown priority "${task.priority}"`);
      }
      for (const offset of [task.startInDays, task.dueInDays]) {
        if (
          offset !== undefined &&
          (!Number.isInteger(offset) || Math.abs(offset) > 365)
        ) {
          error(path, "day offsets are whole numbers within 365");
        }
      }
      if (
        task.startInDays !== undefined &&
        task.dueInDays !== undefined &&
        task.startInDays > task.dueInDays
      ) {
        error(path, "starts after it is due");
      }
      if (task.isMilestone && task.dueInDays === undefined) {
        error(path, "a milestone needs dueInDays");
      }
      if (
        task.estimateValue !== undefined &&
        !estimateValues.has(task.estimateValue)
      ) {
        error(
          path,
          `estimateValue "${task.estimateValue}" is not an estimate value`,
        );
      }
      if (task.module !== undefined) {
        ref(path, "module", modules, task.module);
        if (!on("modules")) error(path, 'a module needs "modules" on');
      }
      if (
        task.cycle !== undefined &&
        !(
          Number.isInteger(task.cycle) &&
          task.cycle >= 0 &&
          task.cycle < cycles.length
        )
      ) {
        error(path, `cycle ${task.cycle} is not an index of sample.cycles`);
      }
      for (const [fieldKey, value] of Object.entries(task.customFields ?? {})) {
        const field = fieldDef.get(fieldKey);
        if (!field) {
          error(path, `unknown custom field "${fieldKey}"`);
          continue;
        }
        const bad =
          (field.type === "dropdown" &&
            !field.options.some((o) => o.key === value)) ||
          (field.type === "boolean" && value !== "true" && value !== "false") ||
          (field.type === "number" &&
            (value.trim() === "" || !Number.isFinite(Number(value)))) ||
          (field.type === "date" && !isValidDateString(value)) ||
          (field.type === "text" && !value.startsWith("projectTemplates:"));
        if (bad)
          error(
            path,
            `invalid value "${value}" for ${field.type} field ${fieldKey}`,
          );
      }
      for (const relation of task.relations ?? []) {
        ref(path, "sample task", samples, relation.to);
        if (relation.to === task.key)
          error(path, "a task can't relate to itself");
        if (relation.type === "blocks") {
          blocks.set(task.key, [...(blocks.get(task.key) ?? []), relation.to]);
        }
      }
      if (task.recurrence) {
        recurring += 1;
        const parsed = setTaskRecurrenceBody.safeParse({
          ...task.recurrence,
          weekdays: task.recurrence.weekdays
            ? [...task.recurrence.weekdays]
            : undefined,
        });
        if (!parsed.success)
          error(`${path}.recurrence`, zodMessage(parsed.error));
      }
    });
    if (recurring > 3)
      warn("sample.tasks", "keep recurrence to a few sample tasks");
    // "blocks" must not loop.
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (key: string): boolean => {
      if (done.has(key)) return false;
      if (visiting.has(key)) return true;
      visiting.add(key);
      const loops = (blocks.get(key) ?? []).some(visit);
      visiting.delete(key);
      done.add(key);
      return loops;
    };
    for (const key of blocks.keys()) {
      if (visit(key)) {
        error("sample.tasks", "blocks relations form a loop");
        break;
      }
    }
  }
}

function checkLocale(
  definition: ProjectTemplate,
  resolved: ReturnType<typeof resolveTemplate>,
  locale: string,
  error: Report,
) {
  const fail = (path: string, message: string) => error(path, message, locale);
  const refs = placeholderRefs();
  const { t } = resolved;
  const caseless = (values: string[]) =>
    duplicates(values.map((value) => value.toLocaleLowerCase(locale)));

  for (const part of ["name", "pitch", "description"] as const) {
    if (!resolved[part].trim()) fail(part, "is empty");
  }

  // Columns: slugs non-empty, unique, not virtual statuses.
  resolved.columns.forEach((column, index) => {
    if (!column.slug)
      fail(`columns[${index}]`, `"${column.name}" has no letters or digits`);
    if ((VIRTUAL_STATUSES as readonly string[]).includes(column.slug)) {
      fail(
        `columns[${index}]`,
        `"${column.name}" slugs to reserved "${column.slug}"`,
      );
    }
  });
  for (const slug of duplicates(resolved.columns.map((c) => c.slug))) {
    fail("columns", `two columns slug to "${slug}"`);
  }

  // Labels.
  resolved.labels.forEach((label, index) => {
    if (!label.name) fail(`labels[${index}]`, "empty name");
    if (label.name.length > MAX_LABEL_NAME) {
      fail(
        `labels[${index}]`,
        `"${label.name}" is longer than ${MAX_LABEL_NAME}`,
      );
    }
  });
  for (const name of caseless(resolved.labels.map((l) => l.name))) {
    fail("labels", `two labels named "${name}"`);
  }

  // Custom fields.
  resolved.fields.forEach((field, index) => {
    const path = `customFields[${index}]`;
    const created = createCustomFieldBody.safeParse({
      projectId: "project",
      name: field.name,
      type: field.type,
      required: field.required,
      ...(field.defaultValue !== null
        ? { defaultValue: field.defaultValue }
        : {}),
      ...(field.options ? { options: field.options } : {}),
    });
    if (!created.success) fail(path, zodMessage(created.error));
    const caps = updateCustomFieldBody.safeParse({
      name: field.name,
      ...(field.options ? { options: field.options } : {}),
    });
    if (!caps.success) fail(path, zodMessage(caps.error));
    if (field.options) {
      if (field.options.some((option) => !option.trim()))
        fail(path, "an empty option");
      for (const option of duplicates(field.options)) {
        fail(path, `option "${option}" twice`);
      }
    }
    if (field.required && !field.defaultValue?.trim()) {
      fail(path, "a required field needs a non-empty default");
    }
  });
  for (const name of caseless(resolved.fields.map((f) => f.name))) {
    fail("customFields", `two fields named "${name}"`);
  }

  // Estimate.
  if (resolved.estimate) {
    const values = resolved.estimate.points.map((point) => point.rawText);
    const parsed = createEstimateBody.safeParse({
      name: resolved.estimate.name,
      type: resolved.estimate.type,
      values,
    });
    if (!parsed.success) fail("estimate", zodMessage(parsed.error));
    const checked = validateEstimateValues(resolved.estimate.type, values);
    if (!checked.ok) {
      for (const issue of checked.errors) {
        fail(
          "estimate.values",
          issue.index >= 0
            ? `"${values[issue.index]}": ${issue.code}`
            : issue.code,
        );
      }
    }
  }

  // Modules.
  (definition.modules ?? []).forEach((module, index) => {
    const parsed = createModuleBody.safeParse({
      name: t(module.name),
      ...(module.description ? { description: t(module.description) } : {}),
      ...(module.status ? { status: module.status } : {}),
    });
    if (!parsed.success) fail(`modules[${index}]`, zodMessage(parsed.error));
  });
  for (const name of caseless(
    (definition.modules ?? []).map((m) => t(m.name).trim()),
  )) {
    fail("modules", `two modules named "${name}"`);
  }

  // Task templates.
  const templates = buildTaskTemplates(resolved, refs);
  templates.forEach(({ position: _position, ...template }, index) => {
    const parsed = createTemplateBody.safeParse({
      projectId: "project",
      ...template,
    });
    if (!parsed.success)
      fail(`taskTemplates[${index}]`, zodMessage(parsed.error));
  });
  for (const name of caseless(templates.map((template) => template.name))) {
    fail("taskTemplates", `two task templates named "${name}"`);
  }

  // Views.
  const viewNames: string[] = [];
  (definition.views ?? []).forEach((view, index) => {
    const path = `views[${index}]`;
    const built = buildView(resolved, view, refs);
    viewNames.push(built.name);
    const parsed = createViewBody.safeParse({
      workspaceId: "workspace",
      projectId: "project",
      name: built.name,
      description: built.description,
      access: built.access,
      filters: { root: built.filters.root, archived: built.filters.archived },
      display: built.display,
      displayProperties: built.displayProperties,
    });
    if (!parsed.success) {
      fail(path, zodMessage(parsed.error));
      return;
    }
    try {
      assertViewFilters(built.filters, {
        scope: "project",
        workspaceId: "workspace",
        userId: refs.userId,
      });
      assertViewDisplay(built.display, "project");
      assertViewDisplayProperties(built.displayProperties, "project");
    } catch (caught) {
      fail(path, errorMessage(caught));
    }
  });
  for (const name of caseless(viewNames))
    fail("views", `two views named "${name}"`);

  // Automation rules.
  (definition.automationRules ?? []).forEach((rule, index) => {
    const path = `automationRules[${index}]`;
    const built = buildRule(resolved, rule, refs);
    if (!built) return;
    const parsed = createAutomationRuleBody.safeParse(built);
    if (!parsed.success) fail(path, zodMessage(parsed.error));
    for (const action of built.actions) {
      const texts =
        action.type === "add_comment"
          ? [action.template]
          : action.type === "create_subtask"
            ? [action.title]
            : action.type === "notify" && action.message
              ? [action.message]
              : [];
      for (const text of texts) {
        const unknown = unknownTemplateVariables(text);
        if (unknown.length > 0) {
          fail(
            path,
            `unknown variable ${unknown.map((name) => `{{${name}}}`).join(", ")}`,
          );
        }
      }
    }
  });

  // Request form.
  const form = buildIntakeForm(resolved, refs);
  if (form) {
    if ((form.title ?? "").length > MAX_FORM_TITLE)
      fail("intakeForm.title", `longer than ${MAX_FORM_TITLE}`);
    if ((form.intro ?? "").length > MAX_FORM_INTRO)
      fail("intakeForm.intro", `longer than ${MAX_FORM_INTRO}`);
    if ((form.confirmationMessage ?? "").length > MAX_FORM_CONFIRMATION) {
      fail(
        "intakeForm.confirmationMessage",
        `longer than ${MAX_FORM_CONFIRMATION}`,
      );
    }
  }

  // Pages and page templates.
  buildPages(resolved).forEach((page, index) => {
    const path = `pages[${index}]`;
    const parsed = createPageBody.safeParse({
      title: page.title,
      content: page.markdown,
      ...(page.logoKind
        ? { logoKind: page.logoKind, logoValue: page.logoValue }
        : {}),
      isFullWidth: page.isFullWidth,
    });
    if (!parsed.success) fail(path, zodMessage(parsed.error));
    if (!page.title) fail(path, "empty title");
    if (Buffer.byteLength(page.markdown) > PAGE_LIMITS.markdownBytes) {
      fail(path, "markdown over 1 MiB");
    }
    try {
      buildPageContent(markdownToJson(page.markdown));
    } catch (caught) {
      fail(path, errorMessage(caught));
    }
  });
  const pageTemplates = buildPageTemplates(resolved);
  pageTemplates.forEach((template, index) => {
    const path = `pageTemplates[${index}]`;
    if (!template.name || template.name.length > PAGE_LIMITS.titleLength) {
      fail(path, `name must be 1-${PAGE_LIMITS.titleLength} characters`);
    }
  });
  for (const name of caseless(pageTemplates.map((template) => template.name))) {
    fail("pageTemplates", `two page templates named "${name}"`);
  }
  (definition.pageTemplates ?? []).forEach((template, index) => {
    if (!sectionsMarkdown(resolved, template.sections)) {
      fail(`pageTemplates[${index}]`, "empty content");
    }
  });

  // Whiteboards.
  (definition.whiteboards ?? []).forEach((board, index) => {
    const parsed = createWhiteboardBody.safeParse({
      projectId: "project",
      title: t(board.title),
      ...(board.icon ? { icon: board.icon } : {}),
    });
    if (!parsed.success)
      fail(`whiteboards[${index}]`, zodMessage(parsed.error));
  });

  // Sample data.
  const plan = planSampleData(resolved, "2026-01-15");
  plan.tasks.forEach((task) => {
    if (!task.title || task.title.length > 500) {
      fail(`sample.tasks.${task.key}`, "title must be 1-500 characters");
    }
  });
  plan.cycles.forEach((cycle, index) => {
    const parsed = createCycleBody.safeParse({
      name: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
    });
    if (!parsed.success)
      fail(`sample.cycles[${index}]`, zodMessage(parsed.error));
  });
}
