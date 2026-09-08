// English one-liners of the task-detail activity types, for search results.
// The web renders its own translated sentences from the same eventData.

type Data = Record<string, unknown>;

const RELATION_ADDED: Record<string, string> = {
  related: "marked this task as related to",
  blocking: "marked this task as blocking",
  blocked_by: "marked this task as blocked by",
  duplicate: "marked this task as a duplicate of",
  start_before: "set this task to start before",
  start_after: "set this task to start after",
  finish_before: "set this task to finish before",
  finish_after: "set this task to finish after",
};

const RELATION_GROUP: Record<string, string> = {
  related: "relates to",
  blocking: "blocking",
  blocked_by: "blocked by",
  duplicate: "duplicate of",
  start_before: "starts before",
  start_after: "starts after",
  finish_before: "finishes before",
  finish_after: "finishes after",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function taskLabel(key: unknown, title: unknown): string {
  return [text(key), text(title)].filter(Boolean).join(" ") || "a task";
}

function otherTask(data: Data) {
  return taskLabel(data.otherTaskKey, data.otherTaskTitle);
}

function parentLabel(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const parent = value as Data;
  return taskLabel(parent.key, parent.title);
}

function linkLabel(data: Data) {
  return text(data.title) || text(data.host) || text(data.url) || "a link";
}

/** The summary of a task-detail activity row, or undefined for other types. */
export function taskDetailActivitySummary(
  type: string,
  data: Data,
): string | undefined {
  switch (type) {
    case "start_date_changed":
      if (!data.newStartDate) return "cleared the start date";
      if (!data.oldStartDate) {
        return `set the start date to ${text(data.newStartDate)}`;
      }
      return `changed the start date from ${text(data.oldStartDate)} to ${text(data.newStartDate)}`;
    case "label_added":
      return `added the label ${text(data.name)}`;
    case "label_removed":
      return `removed the label ${text(data.name)}`;
    case "description_changed":
      return "updated the description";
    case "relation_added": {
      const phrase =
        RELATION_ADDED[text(data.relation)] ?? RELATION_ADDED.related;
      return `${phrase} ${otherTask(data)}`;
    }
    case "relation_removed": {
      const group = RELATION_GROUP[text(data.relation)] ?? text(data.relation);
      return `removed the ${group} relation with ${otherTask(data)}`;
    }
    case "parent_changed": {
      const from = parentLabel(data.oldParent);
      const to = parentLabel(data.newParent);
      if (from && to) return `changed the parent from ${from} to ${to}`;
      if (to) return `set the parent to ${to}`;
      return `removed the parent ${from ?? "task"}`;
    }
    case "subtask_added":
      return `added the sub-task ${otherTask(data)}`;
    case "subtask_removed":
      return `removed the sub-task ${otherTask(data)}`;
    case "link_added":
      return `added the link ${linkLabel(data)}`;
    case "link_updated":
      return `updated the link ${linkLabel(data)}`;
    case "link_removed":
      return `removed the link ${linkLabel(data)}`;
    case "attachment_added":
      return `attached ${text(data.filename)}`;
    case "attachment_removed":
      return `removed the attachment ${text(data.filename)}`;
    case "copied_from":
      return `created this task as a copy of ${taskLabel(data.sourceTaskKey, data.sourceTaskTitle)}`;
    case "copied_to":
      return `made a copy of this task: ${taskLabel(data.copyTaskKey, data.copyTaskTitle)}`;
    default:
      return undefined;
  }
}
