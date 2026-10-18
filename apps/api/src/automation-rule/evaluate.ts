import type {
  AutomationCondition,
  AutomationConditionGroup,
  AutomationTrigger,
} from "./vocabulary";

// Pure rule logic: does an event match a trigger, do a task's facts meet
// the conditions, and what does a template say. No database, no clock.

/** What happened, as the engine's subscribers read it from an event. */
export type TriggerEvent = { projectId: string; taskId: string } & (
  | { type: "task_created"; fromIntake: boolean }
  | { type: "status_changed"; from: string | null; to: string }
  | { type: "assignee_added" | "assignee_removed"; userId: string }
  | { type: "label_added" | "label_removed"; label: string }
  | { type: "priority_changed"; to: string }
  | { type: "due_date_set" | "due_date_passed" | "comment_added" }
  | { type: "moved_to_cycle"; cycleId: string }
  | { type: "moved_to_module"; moduleId: string }
);

/** One task as conditions and templates see it. */
export type TaskFacts = {
  id: string;
  projectId: string;
  number: number | null;
  title: string;
  /** The status slug. */
  status: string;
  columnId: string | null;
  priority: string;
  dueDate: Date | null;
  /** Points of the task's estimate, when numeric. */
  estimate: number | null;
  estimateSet: boolean;
  assigneeIds: readonly string[];
  labels: readonly string[];
  customFields: Readonly<Record<string, string | null>>;
  createdBy: string | null;
  projectSlug: string;
  projectName: string;
  leadId: string | null;
};

/** Column id to slug, so ids in rules compare with task statuses. */
export type RuleRefs = { columnSlugs: ReadonlyMap<string, string> };

const sameLabel = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

function inList(list: readonly string[] | undefined, value: string): boolean {
  return !list || list.length === 0 || list.includes(value);
}

function statusIn(
  columnIds: readonly string[] | undefined,
  slug: string | null,
  refs: RuleRefs,
): boolean {
  if (!columnIds || columnIds.length === 0) return true;
  if (!slug) return false;
  return columnIds.some((id) => refs.columnSlugs.get(id) === slug);
}

/** Whether an event fires a rule's trigger (before conditions). */
export function triggerMatches(
  trigger: AutomationTrigger,
  event: TriggerEvent,
  refs: RuleRefs,
): boolean {
  if (trigger.type !== event.type) return false;
  switch (event.type) {
    case "task_created":
      return trigger.type === "task_created" && trigger.fromIntake
        ? event.fromIntake
        : true;
    case "status_changed":
      return (
        trigger.type === "status_changed" &&
        statusIn(trigger.from, event.from, refs) &&
        statusIn(trigger.to, event.to, refs)
      );
    case "assignee_added":
    case "assignee_removed":
      return (
        (trigger.type === "assignee_added" ||
          trigger.type === "assignee_removed") &&
        inList(trigger.userIds, event.userId)
      );
    case "label_added":
    case "label_removed": {
      if (trigger.type !== "label_added" && trigger.type !== "label_removed") {
        return false;
      }
      const labels = trigger.labels ?? [];
      return (
        labels.length === 0 ||
        labels.some((label) => sameLabel(label, event.label))
      );
    }
    case "priority_changed":
      return (
        trigger.type === "priority_changed" &&
        inList(trigger.to as string[] | undefined, event.to)
      );
    case "moved_to_cycle":
      return (
        trigger.type === "moved_to_cycle" &&
        inList(trigger.cycleIds, event.cycleId)
      );
    case "moved_to_module":
      return (
        trigger.type === "moved_to_module" &&
        inList(trigger.moduleIds, event.moduleId)
      );
    default:
      return true;
  }
}

function conditionHolds(
  condition: AutomationCondition,
  task: TaskFacts,
  refs: RuleRefs,
): boolean {
  switch (condition.field) {
    case "status": {
      const hit =
        (task.columnId !== null &&
          condition.columnIds.includes(task.columnId)) ||
        statusIn(condition.columnIds, task.status, refs);
      return condition.op === "is" ? hit : !hit;
    }
    case "labels": {
      const hit = condition.labels.some((wanted) =>
        task.labels.some((label) => sameLabel(label, wanted)),
      );
      return condition.op === "contains" ? hit : !hit;
    }
    case "priority": {
      const hit = (condition.values as readonly string[]).includes(
        task.priority,
      );
      return condition.op === "is" ? hit : !hit;
    }
    case "assignee": {
      if (condition.op === "empty") return task.assigneeIds.length === 0;
      if (condition.op === "not_empty") return task.assigneeIds.length > 0;
      const wanted = condition.userIds ?? [];
      const hit = wanted.some((userId) => task.assigneeIds.includes(userId));
      return condition.op === "is" ? hit : !hit;
    }
    case "due_date":
      return condition.op === "set"
        ? task.dueDate !== null
        : task.dueDate === null;
    case "estimate": {
      if (condition.op === "set") return task.estimateSet;
      if (condition.op === "not_set") return !task.estimateSet;
      if (task.estimate === null || condition.value === undefined) {
        return false;
      }
      return condition.op === "gte"
        ? task.estimate >= condition.value
        : task.estimate <= condition.value;
    }
    case "title": {
      const hit = task.title
        .toLocaleLowerCase()
        .includes(condition.value.toLocaleLowerCase());
      return condition.op === "contains" ? hit : !hit;
    }
    case "custom_field": {
      const value = task.customFields[condition.fieldId] ?? "";
      const hit = value === condition.value;
      return condition.op === "equals" ? hit : !hit;
    }
  }
}

type GroupItem = AutomationConditionGroup["conditions"][number];

function itemHolds(item: GroupItem, task: TaskFacts, refs: RuleRefs) {
  return "field" in item
    ? conditionHolds(item, task, refs)
    : groupHolds(item as AutomationConditionGroup, task, refs);
}

function groupHolds(
  group: AutomationConditionGroup,
  task: TaskFacts,
  refs: RuleRefs,
): boolean {
  return group.op === "and"
    ? group.conditions.every((item) => itemHolds(item, task, refs))
    : group.conditions.some((item) => itemHolds(item, task, refs));
}

/** Whether the task meets the rule's conditions; none always do. */
export function conditionsHold(
  conditions: AutomationConditionGroup | null | undefined,
  task: TaskFacts,
  refs: RuleRefs,
): boolean {
  if (!conditions) return true;
  return groupHolds(conditions, task, refs);
}

// Template values are inserted into Markdown that is rendered as HTML;
// angle brackets and ampersands are escaped so a title can't add markup.
function escapeValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type TemplateValues = {
  task: TaskFacts;
  statusName: string;
  ruleName: string;
};

/** A template with its {{variables}} filled in; unknown ones go empty. */
export function renderTemplate(
  text: string,
  { task, statusName, ruleName }: TemplateValues,
  options: { escape?: boolean } = {},
): string {
  // The same key format as formatTaskKey (task-activity/task-snapshot.ts).
  const key = `${task.projectSlug.toUpperCase()}-${task.number ?? 0}`;
  const values: Record<string, string> = {
    "task.title": task.title,
    "task.key": key,
    "task.status": statusName,
    "task.priority": task.priority,
    "task.dueDate": task.dueDate ? task.dueDate.toISOString().slice(0, 10) : "",
    "project.name": task.projectName,
    "rule.name": ruleName,
  };
  const shouldEscape = options.escape ?? true;
  return text.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (_match, name: string) => {
    const value = values[name] ?? "";
    return shouldEscape ? escapeValue(value) : value;
  });
}
