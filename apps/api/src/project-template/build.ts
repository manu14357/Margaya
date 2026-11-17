import { TEMPLATE_LABEL_KEYS } from "@margaya/whiteboard";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationConditionGroup,
  AutomationRuleDefinition,
  AutomationTrigger,
} from "../automation-rule/vocabulary";
import type {
  FilterNode,
  GroupByKey,
  OrderByField,
} from "../task-query/schema";
import { nextScheduledRun } from "../task-recurrence/rule";
import { shiftDate } from "../utils/calendar-date";
import {
  defaultViewDisplay,
  defaultViewDisplayProperties,
  defaultViewFilters,
  mergeViewDisplay,
  mergeViewDisplayProperties,
  mergeViewFilters,
} from "../view/normalize";
import type {
  ViewDisplay,
  ViewDisplayProperties,
  ViewFilters,
} from "../view/types";
import { type ResolvedTemplate, WHITEBOARD_LABEL_PREFIX } from "./resolve";
import type {
  AutomationRuleDef,
  ColumnKey,
  FieldKey,
  LabelKey,
  ModuleKey,
  PageKey,
  PageLogo,
  PageSection,
  Priority,
  SampleRecurrence,
  SampleTaskKey,
  TemplateCondition,
  TemplateFilterNode,
  TemplateGroupBy,
  TemplateOrderField,
  ViewDef,
} from "./types";

// Pure row building: a resolved template plus the ids that exist only at
// apply time (TemplateRefs) become the values apply.ts inserts. The checker
// runs the same builders with stand-in ids, so what it validates is exactly
// what gets written.

export type TemplateRefs = {
  userId: string;
  columnId(key: ColumnKey): string;
  /** Null when the label was skipped (no label:create, or being deleted). */
  labelId(key: LabelKey): string | null;
  fieldId(key: FieldKey): string;
  moduleId(key: ModuleKey): string;
  /** The estimate point of a definition value; null without an estimate. */
  pointId(value: string): string | null;
};

/** Stand-in ids for checks and previews: `<kind>:<key>`. */
export function placeholderRefs(
  skippedLabels: ReadonlySet<string> = new Set(),
): TemplateRefs {
  return {
    userId: "user-template-check",
    columnId: (key) => `column-${key}`,
    labelId: (key) => (skippedLabels.has(key) ? null : `label-${key}`),
    fieldId: (key) => `field-${key}`,
    moduleId: (key) => `module-${key}`,
    pointId: (value) => `point-${value}`,
  };
}

function labelName(resolved: ResolvedTemplate, key: LabelKey): string {
  return resolved.labels.find((label) => label.key === key)?.name ?? key;
}

function columnSlug(resolved: ResolvedTemplate, key: ColumnKey): string {
  return resolved.columns.find((column) => column.key === key)?.slug ?? key;
}

/** A dropdown option key becomes its text; other values pass through. */
function fieldValue(
  resolved: ResolvedTemplate,
  fieldKey: FieldKey,
  value: string,
): string {
  const field = resolved.fields.find((item) => item.key === fieldKey);
  if (!field) return value;
  if (field.type === "dropdown") return field.optionText[value] ?? value;
  if (field.type === "text" && value.startsWith("projectTemplates:")) {
    return resolved.t(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Task templates

export function buildTaskTemplates(
  resolved: ResolvedTemplate,
  refs: TemplateRefs,
) {
  const { t } = resolved;
  return (resolved.definition.taskTemplates ?? []).map((template, index) => ({
    name: t(template.name).trim(),
    titlePattern: template.titlePattern ? t(template.titlePattern) : "",
    description: template.description ? t(template.description) : "",
    columnId: template.column ? refs.columnId(template.column) : null,
    priority: template.priority ?? null,
    labelIds: (template.labels ?? [])
      .map((key) => refs.labelId(key))
      .filter((id): id is string => id !== null),
    assigneeIds: template.assignee === "creator" ? [refs.userId] : [],
    estimatePointId:
      template.estimateValue !== undefined
        ? refs.pointId(template.estimateValue)
        : null,
    subtasks: (template.subtasks ?? []).map((key) => t(key).trim()),
    position: index,
  }));
}

// ---------------------------------------------------------------------------
// Saved views

function filterNode(
  resolved: ResolvedTemplate,
  node: TemplateFilterNode,
  refs: TemplateRefs,
): FilterNode {
  if ("op" in node) {
    return {
      op: node.op,
      children: node.children.map((child) => filterNode(resolved, child, refs)),
    };
  }
  switch (node.key) {
    case "status":
      return {
        key: "status",
        operator: node.operator,
        values: node.columns.map((key) => columnSlug(resolved, key)),
      };
    case "label":
      return {
        key: "label",
        operator: node.operator,
        values: [
          ...node.labels.map((key) => `name:${labelName(resolved, key)}`),
          ...(node.includeNone ? ["none"] : []),
        ],
      };
    case "module":
      return {
        key: "module",
        operator: node.operator,
        values: node.modules.map((key) => refs.moduleId(key)),
      };
    case "customField":
      return {
        key: "customField",
        operator: node.operator,
        fieldId: refs.fieldId(node.field),
        values: node.options.map((option) =>
          option === "none" ? "none" : fieldValue(resolved, node.field, option),
        ),
      };
    default: {
      if ("amount" in node) {
        return {
          key: node.key,
          operator: node.operator,
          amount: node.amount,
          unit: node.unit,
        };
      }
      if ("values" in node) {
        return {
          key: node.key,
          operator: node.operator,
          values: [...node.values],
        };
      }
      return { key: node.key, operator: node.operator };
    }
  }
}

function displayKey(
  key: TemplateGroupBy | null | undefined,
  refs: TemplateRefs,
): GroupByKey | null | undefined {
  if (key === undefined || key === null) return key;
  return typeof key === "string"
    ? key
    : `customField:${refs.fieldId(key.customField)}`;
}

function orderField(
  field: TemplateOrderField,
  refs: TemplateRefs,
): OrderByField {
  return typeof field === "string"
    ? field
    : `customField:${refs.fieldId(field.customField)}`;
}

export type BuiltView = {
  name: string;
  description: string;
  access: "private" | "workspace";
  filters: ViewFilters;
  display: ViewDisplay;
  displayProperties: ViewDisplayProperties;
};

export function buildView(
  resolved: ResolvedTemplate,
  view: ViewDef,
  refs: TemplateRefs,
): BuiltView {
  const { t } = resolved;
  const { customFields, ...flags } = view.displayProperties ?? {};
  return {
    name: t(view.name).trim(),
    description: view.description ? t(view.description) : "",
    access: view.access ?? "workspace",
    filters: mergeViewFilters(defaultViewFilters(), {
      root: view.filters?.root
        ? filterNode(resolved, view.filters.root, refs)
        : null,
      archived: view.filters?.archived,
    }),
    display: mergeViewDisplay(defaultViewDisplay("project"), {
      layout: view.display?.layout,
      groupBy: displayKey(view.display?.groupBy, refs),
      subGroupBy: displayKey(view.display?.subGroupBy, refs),
      orderBy: view.display?.orderBy
        ? {
            field: orderField(view.display.orderBy.field, refs),
            direction: view.display.orderBy.direction,
          }
        : undefined,
      showSubTasks: view.display?.showSubTasks,
      showEmptyGroups: view.display?.showEmptyGroups,
    }),
    displayProperties: mergeViewDisplayProperties(
      defaultViewDisplayProperties(),
      {
        ...flags,
        customFields: customFields?.map((key) => refs.fieldId(key)),
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Automation rules

/** Label keys a rule names anywhere. */
export function ruleLabelKeys(rule: AutomationRuleDef): LabelKey[] {
  const keys: LabelKey[] = [];
  if (
    rule.trigger.type === "label_added" ||
    rule.trigger.type === "label_removed"
  ) {
    keys.push(...(rule.trigger.labels ?? []));
  }
  const conditions = (items: readonly unknown[]) => {
    for (const item of items) {
      const condition = item as TemplateCondition | { conditions: unknown[] };
      if ("conditions" in condition) conditions(condition.conditions);
      else if (condition.field === "labels") keys.push(...condition.labels);
    }
  };
  conditions(rule.conditions?.conditions ?? []);
  for (const action of rule.actions) {
    if (action.type === "add_label" || action.type === "remove_label") {
      keys.push(action.label);
    }
  }
  return keys;
}

function buildCondition(
  resolved: ResolvedTemplate,
  condition: TemplateCondition,
  refs: TemplateRefs,
): AutomationCondition {
  switch (condition.field) {
    case "status":
      return {
        field: "status",
        op: condition.op,
        columnIds: condition.columns.map((key) => refs.columnId(key)),
      };
    case "labels":
      return {
        field: "labels",
        op: condition.op,
        labels: condition.labels.map((key) => labelName(resolved, key)),
      };
    case "priority":
      return {
        field: "priority",
        op: condition.op,
        values: [...condition.values],
      };
    case "title":
      return {
        field: "title",
        op: condition.op,
        value: resolved.t(condition.value),
      };
    case "custom_field":
      return {
        field: "custom_field",
        fieldId: refs.fieldId(condition.fieldKey),
        op: condition.op,
        value: fieldValue(resolved, condition.fieldKey, condition.value),
      };
    case "estimate":
      return condition.value === undefined
        ? { field: "estimate", op: condition.op }
        : { field: "estimate", op: condition.op, value: condition.value };
    default:
      return { ...condition };
  }
}

function buildTrigger(
  resolved: ResolvedTemplate,
  rule: AutomationRuleDef,
  refs: TemplateRefs,
): AutomationTrigger {
  const trigger = rule.trigger;
  switch (trigger.type) {
    case "status_changed":
      return {
        type: "status_changed",
        ...(trigger.from
          ? { from: trigger.from.map((key) => refs.columnId(key)) }
          : {}),
        ...(trigger.to
          ? { to: trigger.to.map((key) => refs.columnId(key)) }
          : {}),
      };
    case "label_added":
    case "label_removed":
      return {
        type: trigger.type,
        ...(trigger.labels
          ? { labels: trigger.labels.map((key) => labelName(resolved, key)) }
          : {}),
      };
    case "priority_changed":
      return {
        type: "priority_changed",
        ...(trigger.to ? { to: [...trigger.to] } : {}),
      };
    case "moved_to_module":
      return {
        type: "moved_to_module",
        ...(trigger.modules
          ? { moduleIds: trigger.modules.map((key) => refs.moduleId(key)) }
          : {}),
      };
    case "task_created":
      return trigger.fromIntake === undefined
        ? { type: "task_created" }
        : { type: "task_created", fromIntake: trigger.fromIntake };
    default:
      return { type: trigger.type };
  }
}

function buildAction(
  resolved: ResolvedTemplate,
  action: AutomationRuleDef["actions"][number],
  refs: TemplateRefs,
): AutomationAction {
  const { t } = resolved;
  switch (action.type) {
    case "set_status":
      return { type: "set_status", columnId: refs.columnId(action.column) };
    case "unassign":
      return { type: "unassign", userIds: [] };
    case "assign":
      return { type: "assign", userIds: [refs.userId] };
    case "add_label":
    case "remove_label":
      return { type: action.type, label: labelName(resolved, action.label) };
    case "set_priority":
      return { type: "set_priority", priority: action.priority };
    case "set_due_date":
      return { type: "set_due_date", offsetDays: action.offsetDays };
    case "add_comment":
      return { type: "add_comment", template: t(action.template) };
    case "move_to_module":
      return { type: "move_to_module", moduleId: refs.moduleId(action.module) };
    case "create_subtask":
      return { type: "create_subtask", title: t(action.title) };
    case "notify":
      return {
        type: "notify",
        roles: [...action.roles],
        ...(action.message ? { message: t(action.message) } : {}),
      };
  }
}

/**
 * The rule as POST /automation-rule takes it (ids resolved, label names
 * inlined), or null when it names a skipped label: a rule that adds or
 * watches a label the creator may not create would quietly change meaning.
 */
export function buildRule(
  resolved: ResolvedTemplate,
  rule: AutomationRuleDef,
  refs: TemplateRefs,
): (AutomationRuleDefinition & { enabled: boolean }) | null {
  if (ruleLabelKeys(rule).some((key) => refs.labelId(key) === null)) {
    return null;
  }
  const conditions: AutomationConditionGroup | null = rule.conditions
    ? {
        op: rule.conditions.op,
        conditions: rule.conditions.conditions.map((item) =>
          "conditions" in item
            ? {
                op: item.op,
                conditions: item.conditions.map((condition) =>
                  buildCondition(resolved, condition, refs),
                ),
              }
            : buildCondition(resolved, item, refs),
        ),
      }
    : null;
  return {
    name: resolved.t(rule.name).trim(),
    enabled: rule.enabled ?? true,
    trigger: buildTrigger(resolved, rule, refs),
    conditions,
    actions: rule.actions.map((action) => buildAction(resolved, action, refs)),
  };
}

// ---------------------------------------------------------------------------
// One-row settings

export function buildProjectAutomation(
  resolved: ResolvedTemplate,
  refs: TemplateRefs,
) {
  const scheduled = resolved.definition.scheduledAutomations;
  if (!scheduled) return null;
  return {
    autoArchiveEnabled: scheduled.autoArchive?.enabled ?? false,
    autoArchiveMonths: scheduled.autoArchive?.months ?? 3,
    autoCloseEnabled: scheduled.autoClose?.enabled ?? false,
    autoCloseMonths: scheduled.autoClose?.months ?? 3,
    autoCloseColumnId: scheduled.autoClose?.column
      ? refs.columnId(scheduled.autoClose.column)
      : null,
    cycleRolloverEnabled: scheduled.cycleRollover?.enabled ?? false,
    flowAlertsEnabled: scheduled.flowAlerts?.enabled ?? false,
  };
}

export function buildIntakeForm(
  resolved: ResolvedTemplate,
  refs: TemplateRefs,
) {
  const form = resolved.definition.intakeForm;
  if (!form) return null;
  const { t } = resolved;
  return {
    enabled: false,
    title: form.title ? t(form.title) : null,
    intro: form.intro ? t(form.intro) : null,
    descriptionField: form.descriptionField ?? "optional",
    emailField: form.emailField ?? "required",
    nameField: form.nameField ?? "optional",
    customFieldIds: (form.customFields ?? []).map((key) => refs.fieldId(key)),
    confirmationMessage: form.confirmationMessage
      ? t(form.confirmationMessage)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Pages, page templates and whiteboards

/** "## heading" sections, each followed by its starter line. */
export function sectionsMarkdown(
  resolved: ResolvedTemplate,
  sections: readonly PageSection[],
): string {
  return sections
    .map(({ heading, starter }) => {
      const line =
        starter === undefined || starter === ""
          ? ""
          : starter.startsWith("projectTemplates:")
            ? resolved.t(starter)
            : starter;
      const title = `## ${resolved.t(heading).trim()}`;
      return line ? `${title}\n\n${line}` : title;
    })
    .join("\n\n");
}

function logoFields(logo: PageLogo | undefined) {
  return logo
    ? { logoKind: logo.kind, logoValue: logo.value }
    : { logoKind: null, logoValue: null };
}

export type BuiltPage = {
  key: PageKey;
  parentKey: PageKey | null;
  position: number;
  title: string;
  logoKind: "emoji" | "icon" | null;
  logoValue: string | null;
  isFullWidth: boolean;
  markdown: string;
};

/** Pages with parents before their children; positions per parent. */
export function buildPages(resolved: ResolvedTemplate): BuiltPage[] {
  const pages = resolved.definition.pages ?? [];
  const ordered: (typeof pages)[number][] = [];
  const placed = new Set<string>();
  // Parents first. A cycle or a missing parent (checker errors) stops the walk.
  for (
    let pass = 0;
    pass < pages.length && ordered.length < pages.length;
    pass++
  ) {
    for (const page of pages) {
      if (placed.has(page.key)) continue;
      if (!page.parent || placed.has(page.parent)) {
        ordered.push(page);
        placed.add(page.key);
      }
    }
  }
  const positions = new Map<string, number>();
  return ordered.map((page) => {
    const parentKey = page.parent ?? null;
    const slot = parentKey ?? "";
    const position = positions.get(slot) ?? 0;
    positions.set(slot, position + 1);
    return {
      key: page.key,
      parentKey,
      position,
      title: resolved.t(page.title).trim(),
      ...logoFields(page.logo),
      isFullWidth: page.isFullWidth ?? false,
      markdown: sectionsMarkdown(resolved, page.sections),
    };
  });
}

export function buildPageTemplates(resolved: ResolvedTemplate) {
  return (resolved.definition.pageTemplates ?? []).map((template) => ({
    name: resolved.t(template.name).trim(),
    ...logoFields(template.logo),
    contentMarkdown: sectionsMarkdown(resolved, template.sections),
  }));
}

/** Translated labels for a whiteboard layout, keyed as templateElements wants. */
export function whiteboardLabels(
  resolved: ResolvedTemplate,
  board: keyof typeof TEMPLATE_LABEL_KEYS,
): Record<string, string> {
  return Object.fromEntries(
    (TEMPLATE_LABEL_KEYS[board] ?? []).map((key) => [
      key,
      resolved.t(`${WHITEBOARD_LABEL_PREFIX}${key}`),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Sample data

export type PlannedSampleTask = {
  key: string;
  number: number;
  position: number;
  title: string;
  description: string | null;
  columnKey: ColumnKey;
  priority: Priority;
  labelKeys: LabelKey[];
  assignCreator: boolean;
  /** Workspace-local calendar dates. */
  startDate: string | null;
  dueDate: string | null;
  isMilestone: boolean;
  estimateValue: string | null;
  /** Field key -> stored value (text). */
  fieldValues: Record<FieldKey, string>;
  moduleKey: ModuleKey | null;
  cycleIndex: number | null;
  parentKey: SampleTaskKey | null;
  recurrence:
    | (Required<Pick<SampleRecurrence, "frequency" | "trigger">> & {
        interval: number;
        weekdays: number[] | null;
        monthDay: number | null;
        anchorDate: string;
        nextRunDate: string | null;
      })
    | null;
};

export type SamplePlan = {
  tasks: PlannedSampleTask[];
  relations: { from: string; to: string; type: string }[];
  cycles: { name: string; startDate: string; endDate: string }[];
};

/**
 * The sample tasks to write, numbered 1..n in definition order (sub-tasks
 * right after their parent), with dates counted from `today` (the
 * workspace's local date). `maxTasks` (workspace starters) keeps only the
 * first top-level tasks, without sub-tasks or relations to dropped tasks.
 */
export function planSampleData(
  resolved: ResolvedTemplate,
  today: string,
  { maxTasks }: { maxTasks?: number } = {},
): SamplePlan {
  const sample = resolved.definition.sample;
  if (!sample) return { tasks: [], relations: [], cycles: [] };
  const limited = maxTasks !== undefined;
  const chosen = limited ? sample.tasks.slice(0, maxTasks) : sample.tasks;
  const chosenKeys = new Set(chosen.map((task) => task.key));
  const { t } = resolved;
  const tasks: PlannedSampleTask[] = [];
  const relations: SamplePlan["relations"] = [];
  const positions = new Map<string, number>();
  const nextPosition = (column: string) => {
    const position = positions.get(column) ?? 0;
    positions.set(column, position + 1);
    return position;
  };
  const date = (offset: number | undefined) =>
    offset === undefined ? null : shiftDate(today, offset);
  const defaultValues: Record<string, string> = {};
  for (const field of resolved.fields) {
    if (field.defaultValue !== null && field.defaultValue.trim() !== "") {
      defaultValues[field.key] = field.defaultValue;
    }
  }

  for (const task of chosen) {
    const startDate = date(task.startInDays);
    const dueDate = date(task.dueInDays);
    const fieldValues: Record<string, string> = { ...defaultValues };
    for (const [fieldKey, value] of Object.entries(task.customFields ?? {})) {
      fieldValues[fieldKey] = fieldValue(resolved, fieldKey, value);
    }
    const recurrence = task.recurrence;
    const anchorDate = dueDate ?? startDate ?? today;
    const interval = recurrence?.interval ?? 1;
    const weekdays =
      recurrence?.frequency === "weekly" && recurrence.weekdays
        ? [...new Set(recurrence.weekdays)].sort((a, b) => a - b)
        : null;
    const monthDay =
      recurrence &&
      (recurrence.frequency === "monthly" || recurrence.frequency === "yearly")
        ? (recurrence.monthDay ?? null)
        : null;
    const trigger = recurrence?.trigger ?? "completion";
    tasks.push({
      key: task.key,
      number: tasks.length + 1,
      position: nextPosition(task.column),
      title: t(task.title).trim(),
      description: task.description ? t(task.description) : null,
      columnKey: task.column,
      priority: task.priority ?? "no-priority",
      labelKeys: [...(task.labels ?? [])],
      assignCreator: task.assignee === "creator",
      startDate,
      dueDate,
      isMilestone: task.isMilestone ?? false,
      estimateValue: task.estimateValue ?? null,
      fieldValues,
      moduleKey: task.module ?? null,
      cycleIndex: task.cycle ?? null,
      parentKey: null,
      recurrence: recurrence
        ? {
            frequency: recurrence.frequency,
            trigger,
            interval,
            weekdays,
            monthDay,
            anchorDate,
            nextRunDate:
              trigger === "schedule"
                ? nextScheduledRun({
                    frequency: recurrence.frequency,
                    interval,
                    weekdays,
                    monthDay,
                    anchorDate,
                    endDate: null,
                    maxOccurrences: null,
                    occurrenceCount: 1,
                  })
                : null,
          }
        : null,
    });
    (limited ? [] : (task.subtasks ?? [])).forEach((title, index) => {
      const key = `${task.key}#${index + 1}`;
      tasks.push({
        key,
        number: tasks.length + 1,
        position: nextPosition(task.column),
        title: t(title).trim(),
        description: null,
        columnKey: task.column,
        priority: "no-priority",
        labelKeys: [],
        assignCreator: task.assignee === "creator",
        startDate: null,
        dueDate: null,
        isMilestone: false,
        estimateValue: null,
        fieldValues: { ...defaultValues },
        moduleKey: null,
        cycleIndex: null,
        parentKey: task.key,
        recurrence: null,
      });
      relations.push({ from: task.key, to: key, type: "subtask" });
    });
    for (const relation of task.relations ?? []) {
      if (!chosenKeys.has(relation.to)) continue;
      relations.push({ from: task.key, to: relation.to, type: relation.type });
    }
  }

  return {
    tasks,
    relations,
    cycles: (sample.cycles ?? []).map((cycle) => ({
      name: t(cycle.name).trim(),
      startDate: shiftDate(today, cycle.startInDays),
      endDate: shiftDate(today, cycle.startInDays + cycle.lengthDays - 1),
    })),
  };
}
