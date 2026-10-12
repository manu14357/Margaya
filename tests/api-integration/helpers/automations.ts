import { and, eq } from "drizzle-orm";
import db, { schema } from "../../../apps/api/src/database";
import { automationCutoff } from "../../../apps/api/src/project-automation/cutoff";
import {
  type AutomationJobLimits,
  DEFAULT_AUTOMATION_JOB_LIMITS,
  PROJECT_AUTOMATIONS_LEASE,
  runProjectAutomations,
} from "../../../apps/api/src/project-automation/job";
import { draftScene } from "./drafts";

type TaskInsert = typeof schema.taskTable.$inferInsert;

/** `now` minus whole calendar months, one minute earlier to be clearly past. */
export function monthsAgo(now: Date, months: number): Date {
  return new Date(automationCutoff(now, months).getTime() - 60_000);
}

export async function taskRow(taskId: string) {
  const [row] = await db
    .select()
    .from(schema.taskTable)
    .where(eq(schema.taskTable.id, taskId));
  if (!row) throw new Error(`task ${taskId} is gone`);
  return row;
}

export async function automationRow(projectId: string) {
  const [row] = await db
    .select()
    .from(schema.projectAutomationTable)
    .where(eq(schema.projectAutomationTable.projectId, projectId));
  return row ?? null;
}

/**
 * The draft scene's people and projects, plus a Cancelled-group column
 * "wont-do" in web and helpers to seed tasks with an old `updatedAt`.
 */
export async function automationScene() {
  const s = await draftScene();
  const [wontDo] = await db
    .insert(schema.columnTable)
    .values({
      projectId: s.web.project.id,
      name: "Won't do",
      slug: "wont-do",
      group: "cancelled",
      isFinal: true,
      position: 10,
    })
    .returning();
  if (!wontDo) throw new Error("Failed to create the cancelled column");

  const numbers = new Map<string, number>();
  /** Inserts a task, then sets its updatedAt (default: 4 months ago). */
  const createTask = async (
    values: Partial<TaskInsert> & { updatedAt?: Date } = {},
    now = new Date(),
  ) => {
    const projectId = values.projectId ?? s.web.project.id;
    const number = (numbers.get(projectId) ?? 0) + 1;
    numbers.set(projectId, number);
    const status = values.status ?? "done";
    const [column] = await db
      .select({ id: schema.columnTable.id })
      .from(schema.columnTable)
      .where(
        and(
          eq(schema.columnTable.projectId, projectId),
          eq(schema.columnTable.slug, status),
        ),
      );
    const { updatedAt = monthsAgo(now, 4), ...rest } = values;
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: `Task ${number}`,
        number,
        status,
        columnId: column?.id ?? null,
        ...rest,
      })
      .returning();
    if (!task) throw new Error("Failed to create task");
    await db
      .update(schema.taskTable)
      .set({ updatedAt })
      .where(eq(schema.taskTable.id, task.id));
    return task;
  };

  const configure = async (
    values: Partial<typeof schema.projectAutomationTable.$inferInsert> & {
      projectId?: string;
    },
  ) => {
    const projectId = values.projectId ?? s.web.project.id;
    await db
      .insert(schema.projectAutomationTable)
      .values({ ...values, projectId })
      .onConflictDoUpdate({
        target: schema.projectAutomationTable.projectId,
        set: values,
      });
  };

  const run = async (
    now = new Date(),
    limits: Partial<AutomationJobLimits> = {},
  ) => {
    await db
      .delete(schema.jobLeaseTable)
      .where(eq(schema.jobLeaseTable.name, PROJECT_AUTOMATIONS_LEASE));
    return runProjectAutomations(now, {
      ...DEFAULT_AUTOMATION_JOB_LIMITS,
      ...limits,
    });
  };

  return { ...s, wontDo, createTask, configure, run };
}
