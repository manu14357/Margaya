import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import {
  conditionsHold,
  type RuleRefs,
  type TriggerEvent,
  triggerMatches,
} from "../automation-rule/evaluate";
import { type LoadedTask, loadTaskFacts } from "../automation-rule/facts";
import type { AutomationRuleDefinition } from "../automation-rule/vocabulary";
import db from "../database";
import { activityTable, taskTable } from "../database/schema";
import { boundedTaskRead } from "../task/bounded-read";
import type { DryRunMatch } from "./response";

// Dry run of an automation rule: the project's recorded history in the
// window turned back into trigger events (status, assignee, label,
// priority, due date, comment, cycle and module rows of the activity log,
// task creations and passed due dates), matched against the trigger, then
// checked against each task's current state (the log keeps no full past
// state). Computed only.

const SCAN_CAP = 5000;
const TASK_CAP = 300;
const SLOW = "Dry run took too long; try fewer days";

const ACTIVITY_OF: Partial<Record<TriggerEvent["type"], string>> = {
  status_changed: "status_changed",
  assignee_added: "assignee_changed",
  assignee_removed: "unassigned",
  label_added: "label_added",
  label_removed: "label_removed",
  priority_changed: "priority_changed",
  due_date_set: "due_date_changed",
  comment_added: "comment",
  moved_to_cycle: "cycle_changed",
  moved_to_module: "module_added",
};

type Row = {
  taskId: string;
  at: Date;
  data: Record<string, unknown>;
};

const text = (value: unknown) =>
  typeof value === "string" && value ? value : null;

/** The trigger event an activity row records, or null. */
export function eventOfRow(
  type: TriggerEvent["type"],
  projectId: string,
  row: Row,
): TriggerEvent | null {
  const base = { projectId, taskId: row.taskId };
  const { data } = row;
  switch (type) {
    case "status_changed": {
      const to = text(data.newStatus);
      return to ? { ...base, type, from: text(data.oldStatus), to } : null;
    }
    case "assignee_added": {
      const userId = text(data.newAssigneeId);
      return userId ? { ...base, type, userId } : null;
    }
    case "assignee_removed": {
      const userId = text(data.oldAssigneeId);
      return userId ? { ...base, type, userId } : null;
    }
    case "label_added":
    case "label_removed": {
      const label = text(data.name);
      return label ? { ...base, type, label } : null;
    }
    case "priority_changed": {
      const to = text(data.newPriority);
      return to ? { ...base, type, to } : null;
    }
    case "due_date_set":
      return data.newDueDate ? { ...base, type } : null;
    case "comment_added":
      return { ...base, type };
    case "moved_to_cycle": {
      const cycleId = text(data.newCycleId);
      return cycleId ? { ...base, type, cycleId } : null;
    }
    case "moved_to_module": {
      const moduleId = text(data.moduleId);
      return moduleId ? { ...base, type, moduleId } : null;
    }
    default:
      return null;
  }
}

async function historyRows(
  rule: AutomationRuleDefinition,
  projectId: string,
  from: Date,
  to: Date,
): Promise<Row[]> {
  const type = rule.trigger.type;
  if (type === "task_created") {
    const rows = await db
      .select({ taskId: taskTable.id, at: taskTable.createdAt })
      .from(taskTable)
      .where(
        and(
          eq(taskTable.projectId, projectId),
          isNull(taskTable.deletedAt),
          // No upper bound here or for history rows: the database clock
          // stamps them and may run slightly ahead of this one.
          gte(taskTable.createdAt, from),
        ),
      )
      .orderBy(desc(taskTable.createdAt))
      .limit(SCAN_CAP);
    return rows.map((row) => ({ ...row, data: {} }));
  }
  if (type === "due_date_passed") {
    const rows = await db
      .select({ taskId: taskTable.id, at: taskTable.dueDate })
      .from(taskTable)
      .where(
        and(
          eq(taskTable.projectId, projectId),
          isNull(taskTable.deletedAt),
          gte(taskTable.dueDate, from),
          lte(taskTable.dueDate, to),
        ),
      )
      .orderBy(desc(taskTable.dueDate))
      .limit(SCAN_CAP);
    return rows.flatMap((row) =>
      row.at ? [{ taskId: row.taskId, at: row.at, data: {} }] : [],
    );
  }
  const activityType = ACTIVITY_OF[type];
  if (!activityType) return [];
  const rows = await db
    .select({
      taskId: activityTable.taskId,
      at: activityTable.createdAt,
      eventData: activityTable.eventData,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        isNull(taskTable.deletedAt),
        eq(activityTable.type, activityType),
        gte(activityTable.createdAt, from),
      ),
    )
    .orderBy(desc(activityTable.createdAt))
    .limit(SCAN_CAP);
  return rows.map((row) => ({
    taskId: row.taskId,
    at: row.at,
    data:
      row.eventData && typeof row.eventData === "object"
        ? (row.eventData as Record<string, unknown>)
        : {},
  }));
}

/** What an automation rule would have run on in the window, newest first. */
export async function replayAutomationRule(input: {
  rule: AutomationRuleDefinition;
  projectId: string;
  columns: readonly { id: string; slug: string; name: string }[];
  from: Date;
  to: Date;
}): Promise<DryRunMatch[]> {
  const { rule, projectId, from, to } = input;
  const refs: RuleRefs = {
    columnSlugs: new Map(
      input.columns.map((column) => [column.id, column.slug]),
    ),
  };
  const rows = await boundedTaskRead(
    () => historyRows(rule, projectId, from, to),
    SLOW,
  );
  const matched = rows.flatMap(
    (row): { row: Row; event: TriggerEvent | null }[] => {
      if (
        rule.trigger.type === "task_created" ||
        rule.trigger.type === "due_date_passed"
      ) {
        return [{ row, event: null }];
      }
      const event = eventOfRow(rule.trigger.type, projectId, row);
      return event && triggerMatches(rule.trigger, event, refs)
        ? [{ row, event }]
        : [];
    },
  );

  const taskIds = [...new Set(matched.map((entry) => entry.row.taskId))].slice(
    0,
    TASK_CAP,
  );
  const facts = new Map<string, LoadedTask>();
  for (const taskId of taskIds) {
    const task = await loadTaskFacts(taskId);
    if (task && task.projectId === projectId) facts.set(taskId, task);
  }

  const statusName = (slug: string | null) =>
    input.columns.find((column) => column.slug === slug)?.name ?? slug;
  const matches: DryRunMatch[] = [];
  for (const { row, event } of matched) {
    const task = facts.get(row.taskId);
    if (!task) continue;
    const holds = conditionsHold(rule.conditions, task, refs);
    matches.push({
      taskId: task.id,
      taskNumber: task.number,
      title: task.title,
      at: row.at.toISOString(),
      kind: "automation",
      outcome: holds ? "change" : "skipped",
      from: event?.type === "status_changed" ? statusName(event.from) : null,
      to: event?.type === "status_changed" ? statusName(event.to) : null,
    });
  }
  return matches;
}
