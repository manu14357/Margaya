import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import createComment from "../activity/controllers/create-comment";
import { enqueueAutomationRun } from "../ai-agent/triggers";
import setTaskCycle from "../cycle/controllers/set-task-cycle";
import db from "../database";
import {
  cycleTaskTable,
  labelTable,
  moduleTable,
  userTable,
} from "../database/schema";
import createLabel from "../label/controllers/create-label";
import unassignLabelFromTask from "../label/controllers/unassign-label-from-task";
import { addModuleTasks } from "../module/controllers/module-tasks";
import { writeTaskNotifications } from "../notification/recipients";
import { canSeeProject } from "../project/visibility";
import createTask from "../task/controllers/create-task";
import { updateTaskAssigneesController } from "../task/controllers/update-task-assignees";
import updateTaskDueDate from "../task/controllers/update-task-due-date";
import updateTaskPriority from "../task/controllers/update-task-priority";
import updateTaskStatus from "../task/controllers/update-task-status";
import { startOfLocalDayUtc, todayInTimezone } from "../utils/zoned-date";
import { AUTOMATION_ACTOR } from "./context";
import { renderTemplate } from "./evaluate";
import type { LoadedTask, ProjectColumn } from "./facts";
import type { AutomationAction } from "./vocabulary";

// Each action goes through the existing controller a person's change would
// use, with the system actor, so validation, history, events, realtime,
// notifications and integrations behave exactly as for a person.

export type ActionStatus = "applied" | "unchanged" | "failed";
export type ActionResult = {
  type: AutomationAction["type"];
  status: ActionStatus;
  error?: string;
};

export type ActionContext = {
  task: LoadedTask;
  columns: readonly ProjectColumn[];
  ruleName: string;
  ruleId?: string;
  /** Who last saved the rule: the person run_agent acts for. */
  ruleOwnerId?: string | null;
  /** An agent's change started this chain: run_agent does nothing. */
  causedByAgent?: boolean;
};

/** Neutral grey, used when a new label name has no colour yet. */
const DEFAULT_LABEL_COLOR = "#94a3b8";

class ActionError extends Error {}

function statusName(ctx: ActionContext): string {
  return (
    ctx.columns.find((column) => column.slug === ctx.task.status)?.name ??
    ctx.task.status
  );
}

function fill(ctx: ActionContext, text: string, escapeValues = true): string {
  return renderTemplate(
    text,
    { task: ctx.task, statusName: statusName(ctx), ruleName: ctx.ruleName },
    { escape: escapeValues },
  );
}

/** People who are still members and see the project (restricted ones too). */
async function reachable(
  userIds: readonly string[],
  projectId: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const userId of new Set(userIds)) {
    if (await canSeeProject(userId, projectId)) out.push(userId);
  }
  return out;
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}

/** Runs one action on the context's task. Throws on failure. */
async function apply(
  action: AutomationAction,
  ctx: ActionContext,
  now: Date,
): Promise<ActionStatus> {
  const { task } = ctx;
  switch (action.type) {
    case "set_status": {
      const column = ctx.columns.find((entry) => entry.id === action.columnId);
      if (!column || column.group === "triage") {
        throw new ActionError("COLUMN_NOT_FOUND");
      }
      if (task.status === column.slug) return "unchanged";
      await updateTaskStatus({
        id: task.id,
        status: column.slug,
        currentUserId: AUTOMATION_ACTOR,
      });
      return "applied";
    }
    case "assign": {
      const add = (await reachable(action.userIds, task.projectId)).filter(
        (userId) => !task.assigneeIds.includes(userId),
      );
      if (add.length === 0) return "unchanged";
      await updateTaskAssigneesController({
        id: task.id,
        add,
        currentUserId: AUTOMATION_ACTOR,
      });
      return "applied";
    }
    case "unassign": {
      const remove =
        action.userIds.length === 0
          ? [...task.assigneeIds]
          : action.userIds.filter((userId) =>
              task.assigneeIds.includes(userId),
            );
      if (remove.length === 0) return "unchanged";
      await updateTaskAssigneesController({
        id: task.id,
        remove,
        currentUserId: AUTOMATION_ACTOR,
      });
      return "applied";
    }
    case "add_label": {
      if (task.labels.includes(action.label)) return "unchanged";
      const [known] = await db
        .select({ color: labelTable.color })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.workspaceId, task.workspaceId),
            eq(labelTable.name, action.label),
          ),
        )
        .orderBy(labelTable.createdAt)
        .limit(1);
      await createLabel(
        action.label,
        known?.color ?? DEFAULT_LABEL_COLOR,
        task.id,
        task.workspaceId,
        AUTOMATION_ACTOR,
      );
      return "applied";
    }
    case "remove_label": {
      const rows = await db
        .select({ id: labelTable.id })
        .from(labelTable)
        .where(
          and(
            eq(labelTable.taskId, task.id),
            eq(labelTable.name, action.label),
          ),
        );
      if (rows.length === 0) return "unchanged";
      for (const row of rows) {
        await unassignLabelFromTask(row.id, AUTOMATION_ACTOR);
      }
      return "applied";
    }
    case "set_priority": {
      if (task.priority === action.priority) return "unchanged";
      await updateTaskPriority({
        id: task.id,
        priority: action.priority,
        currentUserId: AUTOMATION_ACTOR,
      });
      return "applied";
    }
    case "set_due_date": {
      const day = addDays(
        todayInTimezone(task.timezone, now),
        action.offsetDays,
      );
      const dueDate = startOfLocalDayUtc(day, task.timezone);
      if (task.dueDate?.getTime() === dueDate.getTime()) return "unchanged";
      await updateTaskDueDate({
        id: task.id,
        dueDate,
        currentUserId: AUTOMATION_ACTOR,
      });
      return "applied";
    }
    case "add_comment": {
      await createComment(
        task.id,
        AUTOMATION_ACTOR,
        fill(ctx, action.template),
        undefined,
        {
          parseMentions: false,
        },
      );
      return "applied";
    }
    case "move_to_cycle": {
      const [current] = await db
        .select({ cycleId: cycleTaskTable.cycleId })
        .from(cycleTaskTable)
        .where(eq(cycleTaskTable.taskId, task.id))
        .limit(1);
      if (current?.cycleId === action.cycleId) return "unchanged";
      await setTaskCycle({
        taskId: task.id,
        cycleId: action.cycleId,
        workspaceId: task.workspaceId,
        userId: AUTOMATION_ACTOR,
      });
      return "applied";
    }
    case "move_to_module": {
      const [found] = await db
        .select({ projectId: moduleTable.projectId })
        .from(moduleTable)
        .where(
          and(
            eq(moduleTable.id, action.moduleId),
            isNull(moduleTable.archivedAt),
          ),
        )
        .limit(1);
      if (found?.projectId !== task.projectId) {
        throw new ActionError("MODULE_NOT_FOUND");
      }
      const change = await addModuleTasks({
        moduleId: action.moduleId,
        userId: AUTOMATION_ACTOR,
        taskIds: [task.id],
      });
      if (change.added.length > 0) return "applied";
      if (change.unchanged.length > 0) return "unchanged";
      throw new ActionError("TASK_NOT_PLANNABLE");
    }
    case "create_subtask": {
      const column = ctx.columns.find(
        (entry) => entry.group !== "triage" && !entry.isFinal,
      );
      if (!column) throw new ActionError("COLUMN_NOT_FOUND");
      await createTask({
        projectId: task.projectId,
        currentUserId: AUTOMATION_ACTOR,
        title: fill(ctx, action.title, false).slice(0, 200),
        status: column.slug,
        assigneeIds: [],
        parentId: task.id,
      });
      return "applied";
    }
    case "run_agent": {
      // Agents never start agents, even through a rule: no loops.
      if (ctx.causedByAgent) return "unchanged";
      if (!ctx.ruleOwnerId) throw new ActionError("NO_RULE_OWNER");
      const run = await enqueueAutomationRun({
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
        agentId: action.agentId,
        principalUserId: ctx.ruleOwnerId,
        ruleId: ctx.ruleId ?? null,
        prompt: fill(ctx, action.prompt, false),
      });
      if (run === "AGENT_UNAVAILABLE") {
        throw new ActionError("AGENT_UNAVAILABLE");
      }
      if (run === "AI_DISABLED") throw new ActionError("AI_DISABLED");
      return "applied";
    }
    case "notify": {
      const roles = new Set(action.roles ?? []);
      const candidates = [
        ...(action.userIds ?? []),
        ...(roles.has("assignees") ? task.assigneeIds : []),
        ...(roles.has("creator") && task.createdBy ? [task.createdBy] : []),
        ...(roles.has("lead") && task.leadId ? [task.leadId] : []),
      ];
      // Agents read no inbox; they are never notified.
      const humans = candidates.length
        ? await db
            .select({ id: userTable.id })
            .from(userTable)
            .where(
              and(
                inArray(userTable.id, [...new Set(candidates)]),
                ne(userTable.kind, "agent"),
              ),
            )
        : [];
      const userIds = await reachable(
        humans.map((user) => user.id),
        task.projectId,
      );
      if (userIds.length === 0) return "unchanged";
      const message = action.message ? fill(ctx, action.message, false) : null;
      await writeTaskNotifications({
        userIds,
        type: "automation_notice",
        taskId: task.id,
        workspaceId: task.workspaceId,
        actorId: null,
        title: `Automation: ${ctx.ruleName}`,
        content: message ?? task.title,
        eventData: {
          taskTitle: task.title,
          taskKey: `${task.projectSlug.toUpperCase()}-${task.number ?? 0}`,
          projectId: task.projectId,
          workspaceId: task.workspaceId,
          ruleName: ctx.ruleName,
          ...(message ? { message } : {}),
        },
      });
      return "applied";
    }
  }
}

function errorCode(error: unknown): string {
  if (error instanceof ActionError) return error.message;
  const status = (error as { status?: number })?.status;
  const message = error instanceof Error ? error.message : String(error);
  return (status ? `${status}: ${message}` : message).slice(0, 200);
}

/** Runs the actions in order; one failing does not stop the next. */
export async function runActions(
  actions: readonly AutomationAction[],
  ctx: ActionContext,
  reload: () => Promise<LoadedTask | null>,
  now: Date = new Date(),
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  let current = ctx;
  for (const action of actions) {
    try {
      const status = await apply(action, current, now);
      results.push({ type: action.type, status });
      if (status === "applied") {
        const task = await reload();
        if (!task) break;
        current = { ...current, task };
      }
    } catch (error) {
      results.push({
        type: action.type,
        status: "failed",
        error: errorCode(error),
      });
    }
  }
  return results;
}
