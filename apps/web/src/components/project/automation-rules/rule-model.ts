import type {
  AutomationAction,
  AutomationCondition,
  AutomationConditions,
  AutomationRuleInput,
  AutomationTrigger,
} from "@/fetchers/automation-rule/automation-rules";

// The "When → If → Then" rule as the editor holds it, with the building
// blocks the builder rows offer and the starting templates.

export type RuleDraft = {
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationConditions | null;
  actions: AutomationAction[];
};

export const TRIGGER_TYPES = [
  "task_created",
  "status_changed",
  "assignee_added",
  "assignee_removed",
  "label_added",
  "label_removed",
  "priority_changed",
  "due_date_set",
  "due_date_passed",
  "comment_added",
  "moved_to_cycle",
  "moved_to_module",
] as const satisfies readonly AutomationTrigger["type"][];
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const CONDITION_FIELDS = [
  "status",
  "labels",
  "priority",
  "assignee",
  "due_date",
  "estimate",
  "title",
  "custom_field",
] as const satisfies readonly AutomationCondition["field"][];
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const ACTION_TYPES = [
  "set_status",
  "assign",
  "unassign",
  "add_label",
  "remove_label",
  "set_priority",
  "set_due_date",
  "add_comment",
  "move_to_cycle",
  "move_to_module",
  "create_subtask",
  "notify",
  "run_agent",
] as const satisfies readonly AutomationAction["type"][];
export type ActionType = (typeof ACTION_TYPES)[number];

export const PRIORITIES = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const NOTIFY_ROLES = ["assignees", "creator", "lead"] as const;

export const TEMPLATE_VARIABLES = [
  "task.title",
  "task.key",
  "task.status",
  "task.priority",
  "task.dueDate",
  "project.name",
  "rule.name",
] as const;

export const OPS_OF: Record<ConditionField, readonly string[]> = {
  status: ["is", "is_not"],
  labels: ["contains", "not_contains"],
  priority: ["is", "is_not"],
  assignee: ["is", "is_not", "empty", "not_empty"],
  due_date: ["set", "not_set"],
  estimate: ["set", "not_set", "gte", "lte"],
  title: ["contains", "not_contains"],
  custom_field: ["equals", "not_equals"],
};

export function emptyTrigger(type: TriggerType): AutomationTrigger {
  return { type } as AutomationTrigger;
}

export function emptyCondition(field: ConditionField): AutomationCondition {
  switch (field) {
    case "status":
      return { field, op: "is", columnIds: [] };
    case "labels":
      return { field, op: "contains", labels: [] };
    case "priority":
      return { field, op: "is", values: [] };
    case "assignee":
      return { field, op: "empty" };
    case "due_date":
      return { field, op: "set" };
    case "estimate":
      return { field, op: "set" };
    case "title":
      return { field, op: "contains", value: "" };
    case "custom_field":
      return { field, fieldId: "", op: "equals", value: "" };
  }
}

export function emptyAction(type: ActionType): AutomationAction {
  switch (type) {
    case "set_status":
      return { type, columnId: "" };
    case "assign":
      return { type, userIds: [] };
    case "unassign":
      return { type, userIds: [] };
    case "add_label":
    case "remove_label":
      return { type, label: "" };
    case "set_priority":
      return { type, priority: "high" };
    case "set_due_date":
      return { type, offsetDays: 1 };
    case "add_comment":
      return { type, template: "" };
    case "move_to_cycle":
      return { type, cycleId: "" };
    case "move_to_module":
      return { type, moduleId: "" };
    case "create_subtask":
      return { type, title: "" };
    case "notify":
      return { type, roles: ["assignees"] };
    case "run_agent":
      return { type, agentId: "", prompt: "" };
  }
}

export function emptyDraft(): RuleDraft {
  return {
    name: "",
    trigger: emptyTrigger("status_changed"),
    conditions: null,
    actions: [emptyAction("assign")],
  };
}

type TemplateColumns = { id: string; name: string; slug: string }[];

/** A column whose name or slug mentions one of the words. */
function columnLike(columns: TemplateColumns, words: string[]) {
  return columns.find((column) =>
    words.some(
      (word) =>
        column.slug.includes(word) || column.name.toLowerCase().includes(word),
    ),
  );
}

export const TEMPLATE_IDS = ["reviewer", "intakeBugs", "overdue"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** A ready-made rule; names come from i18n, ids from the project. */
export function templateDraft(
  id: TemplateId,
  { columns, name }: { columns: TemplateColumns; name: string },
): RuleDraft {
  switch (id) {
    case "reviewer": {
      const review = columnLike(columns, ["review"]);
      return {
        name,
        trigger: {
          type: "status_changed",
          ...(review ? { to: [review.id] } : {}),
        },
        conditions: null,
        actions: [{ type: "assign", userIds: [] }],
      };
    }
    case "intakeBugs":
      return {
        name,
        trigger: { type: "task_created", fromIntake: true },
        conditions: {
          op: "or",
          conditions: [
            { field: "title", op: "contains", value: "bug" },
            { field: "title", op: "contains", value: "error" },
          ],
        },
        actions: [{ type: "add_label", label: "bug" }],
      };
    case "overdue":
      return {
        name,
        trigger: { type: "due_date_passed" },
        conditions: null,
        actions: [
          { type: "set_priority", priority: "urgent" },
          { type: "notify", roles: ["assignees"] },
        ],
      };
  }
}

/** The body the API takes, from a draft. */
export function draftToInput(draft: RuleDraft): AutomationRuleInput {
  return {
    name: draft.name.trim(),
    trigger: draft.trigger,
    conditions:
      draft.conditions && draft.conditions.conditions.length > 0
        ? draft.conditions
        : null,
    actions: draft.actions,
  } as AutomationRuleInput;
}

/** Whether the draft has every required value filled in. */
export function draftComplete(draft: RuleDraft): boolean {
  if (!draft.name.trim() || draft.actions.length === 0) return false;
  const conditionsOk = (draft.conditions?.conditions ?? []).every((item) => {
    if (!("field" in item)) return true;
    switch (item.field) {
      case "status":
        return item.columnIds.length > 0;
      case "labels":
        return item.labels.length > 0;
      case "priority":
        return item.values.length > 0;
      case "assignee":
        return (
          item.op === "empty" ||
          item.op === "not_empty" ||
          (item.userIds?.length ?? 0) > 0
        );
      case "estimate":
        return (
          item.op === "set" || item.op === "not_set" || item.value !== undefined
        );
      case "title":
        return item.value.trim().length > 0;
      case "custom_field":
        return Boolean(item.fieldId);
      default:
        return true;
    }
  });
  const actionsOk = draft.actions.every((action) => {
    switch (action.type) {
      case "set_status":
        return Boolean(action.columnId);
      case "assign":
        return action.userIds.length > 0;
      case "add_label":
      case "remove_label":
        return action.label.trim().length > 0;
      case "add_comment":
        return action.template.trim().length > 0;
      case "create_subtask":
        return action.title.trim().length > 0;
      case "move_to_cycle":
        return Boolean(action.cycleId);
      case "move_to_module":
        return Boolean(action.moduleId);
      case "notify":
        return (
          (action.userIds?.length ?? 0) > 0 || (action.roles?.length ?? 0) > 0
        );
      case "run_agent":
        return Boolean(action.agentId) && action.prompt.trim().length > 0;
      default:
        return true;
    }
  });
  return conditionsOk && actionsOk;
}
