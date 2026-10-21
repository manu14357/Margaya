import { and, asc, count, eq, isNull, lte } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getAiInstanceConfig } from "../ai/instance-config";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  agentScheduleTable,
  agentTable,
  projectTable,
  taskTable,
  userTable,
} from "../database/schema";
import { jsonHttpError } from "../estimate/write";
import { canSeeProject } from "../project/visibility";
import { CronError, nextRunAfter, validateSchedule } from "./cron";
import { getAgent } from "./identity";
import { memberStatements, satisfies } from "./rights";
import { enqueueRun } from "./runner";

// Agent schedules: "run this agent with this prompt every weekday at 9:00
// in Europe/Berlin". The scheduler checks every minute for due schedules
// and claims each with a compare-and-set on next_run_at, so any number of
// API instances can run the job and a schedule fires once per slot. A run
// acts for whoever last saved the schedule; when that person leaves or
// loses ai:use, the schedule turns itself off.

export const MAX_SCHEDULES_PER_AGENT = 20;
const DUE_BATCH = 50;

type ScheduleRow = typeof agentScheduleTable.$inferSelect;

const scheduleColumns = {
  schedule: agentScheduleTable,
  projectName: projectTable.name,
  projectSlug: projectTable.slug,
  taskTitle: taskTable.title,
  taskNumber: taskTable.number,
  runsAsName: userTable.name,
};

function scheduleQuery() {
  return db
    .select(scheduleColumns)
    .from(agentScheduleTable)
    .leftJoin(projectTable, eq(projectTable.id, agentScheduleTable.projectId))
    .leftJoin(taskTable, eq(taskTable.id, agentScheduleTable.taskId))
    .leftJoin(userTable, eq(userTable.id, agentScheduleTable.createdBy));
}

type Joined = Awaited<ReturnType<ReturnType<typeof scheduleQuery>["where"]>>;

function serialize(row: Joined[number]) {
  const s = row.schedule;
  return {
    id: s.id,
    agentId: s.agentId,
    project: row.projectName
      ? { id: s.projectId, name: row.projectName, slug: row.projectSlug ?? "" }
      : null,
    task:
      s.taskId && row.taskTitle !== null
        ? {
            id: s.taskId,
            key: `${(row.projectSlug ?? "").toUpperCase()}-${row.taskNumber ?? 0}`,
            title: row.taskTitle ?? "",
          }
        : null,
    cron: s.cron,
    timezone: s.timezone,
    prompt: s.prompt,
    enabled: s.enabled,
    runsAs: s.createdBy
      ? { id: s.createdBy, name: row.runsAsName ?? "" }
      : null,
    lastRunAt: s.lastRunAt,
    nextRunAt: s.nextRunAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function cronHttpError(error: unknown): never {
  if (error instanceof CronError) {
    throw jsonHttpError(400, {
      code: error.code,
      message:
        error.code === "TIMEZONE_INVALID"
          ? "timezone: not an IANA time zone"
          : error.code === "CRON_TOO_FREQUENT"
            ? "cron: a schedule runs at most every 15 minutes"
            : error.code === "CRON_NEVER"
              ? "cron: this schedule never runs"
              : "cron: use five fields (minute hour day month weekday)",
    });
  }
  throw error;
}

/** The project (and task) must be live, AI-on and visible to the saver. */
async function assertTarget(input: {
  workspaceId: string;
  userId: string;
  projectIds: string[] | null;
  projectId: string;
  taskId: string | null;
}) {
  const [project] = await db
    .select({ id: projectTable.id, aiEnabled: projectTable.aiEnabled })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, input.projectId),
        eq(projectTable.workspaceId, input.workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!project || !(await canSeeProject(input.userId, project.id))) {
    throw new HTTPException(400, { message: "projectId: project not found" });
  }
  if (!project.aiEnabled) {
    throw new HTTPException(400, {
      message: "projectId: AI is turned off for this project",
    });
  }
  if (input.projectIds && !input.projectIds.includes(project.id)) {
    throw jsonHttpError(400, {
      code: "OUTSIDE_AGENT_PROJECTS",
      message: "projectId: this agent isn't set up to work in this project",
    });
  }
  if (input.taskId) {
    const [task] = await db
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(
        and(
          eq(taskTable.id, input.taskId),
          eq(taskTable.projectId, project.id),
          isNull(taskTable.deletedAt),
        ),
      )
      .limit(1);
    if (!task) {
      throw new HTTPException(400, {
        message: "taskId: not a task of this project",
      });
    }
  }
}

/** The saver becomes the runs' person, so they need ai:use themselves. */
async function assertMayRunAs(workspaceId: string, userId: string) {
  const rights = await memberStatements(workspaceId, userId);
  if (!rights || !satisfies(rights, { ai: ["use"] })) {
    throw new HTTPException(403, {
      message: "Scheduled runs act for you, so you need ai:use",
    });
  }
}

async function loadSchedule(input: {
  workspaceId: string;
  agentId: string;
  scheduleId: string;
}) {
  const [row] = await scheduleQuery()
    .where(
      and(
        eq(agentScheduleTable.id, input.scheduleId),
        eq(agentScheduleTable.agentId, input.agentId),
        eq(agentScheduleTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Schedule not found" });
  return row;
}

export async function listSchedules(workspaceId: string, agentId: string) {
  await getAgent(workspaceId, agentId);
  const rows = await scheduleQuery()
    .where(
      and(
        eq(agentScheduleTable.agentId, agentId),
        eq(agentScheduleTable.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(agentScheduleTable.createdAt), asc(agentScheduleTable.id));
  return rows.map(serialize);
}

export type ScheduleInput = {
  projectId: string;
  taskId?: string | null;
  cron: string;
  timezone: string;
  prompt: string;
  enabled?: boolean;
};

export async function createSchedule(input: {
  workspaceId: string;
  agentId: string;
  userId: string;
  schedule: ScheduleInput;
  now?: Date;
}) {
  const agent = await getAgent(input.workspaceId, input.agentId);
  await assertMayRunAs(input.workspaceId, input.userId);
  const [{ value } = { value: 0 }] = await db
    .select({ value: count() })
    .from(agentScheduleTable)
    .where(eq(agentScheduleTable.agentId, agent.id));
  if (Number(value) >= MAX_SCHEDULES_PER_AGENT) {
    throw new HTTPException(409, {
      message: `An agent can have at most ${MAX_SCHEDULES_PER_AGENT} schedules`,
    });
  }
  const { schedule } = input;
  const taskId = schedule.taskId ?? null;
  await assertTarget({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectIds: agent.projectIds,
    projectId: schedule.projectId,
    taskId,
  });
  let checked: ReturnType<typeof validateSchedule>;
  try {
    checked = validateSchedule(schedule.cron, schedule.timezone, input.now);
  } catch (error) {
    cronHttpError(error);
  }
  const enabled = schedule.enabled ?? true;
  const [row] = await db
    .insert(agentScheduleTable)
    .values({
      workspaceId: input.workspaceId,
      agentId: agent.id,
      projectId: schedule.projectId,
      taskId,
      cron: checked.cron,
      timezone: schedule.timezone,
      prompt: schedule.prompt.trim(),
      enabled,
      createdBy: input.userId,
      nextRunAt: enabled ? checked.nextRunAt : null,
    })
    .returning({ id: agentScheduleTable.id });
  if (!row) throw new HTTPException(500, { message: "Could not save" });
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.schedule_created",
    target: { type: "agent", id: agent.id, label: agent.name },
    metadata: { scheduleId: row.id, cron: checked.cron },
  });
  return serialize(await loadSchedule({ ...input, scheduleId: row.id }));
}

export async function updateSchedule(input: {
  workspaceId: string;
  agentId: string;
  scheduleId: string;
  userId: string;
  patch: Partial<ScheduleInput>;
  now?: Date;
}) {
  const agent = await getAgent(input.workspaceId, input.agentId);
  const current = (await loadSchedule(input)).schedule;
  await assertMayRunAs(input.workspaceId, input.userId);
  const { patch } = input;
  const projectId = patch.projectId ?? current.projectId;
  const taskId =
    patch.taskId !== undefined
      ? patch.taskId
      : patch.projectId && patch.projectId !== current.projectId
        ? null
        : current.taskId;
  await assertTarget({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectIds: agent.projectIds,
    projectId,
    taskId,
  });
  const cron = patch.cron ?? current.cron;
  const timezone = patch.timezone ?? current.timezone;
  const enabled = patch.enabled ?? current.enabled;
  let checked: ReturnType<typeof validateSchedule>;
  try {
    checked = validateSchedule(cron, timezone, input.now);
  } catch (error) {
    cronHttpError(error);
  }
  await db
    .update(agentScheduleTable)
    .set({
      projectId,
      taskId,
      cron: checked.cron,
      timezone,
      prompt: patch.prompt?.trim() ?? current.prompt,
      enabled,
      // Whoever saves it vouches for it: the runs act for them from now on.
      createdBy: input.userId,
      nextRunAt: enabled ? checked.nextRunAt : null,
    })
    .where(eq(agentScheduleTable.id, current.id));
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.schedule_updated",
    target: { type: "agent", id: agent.id, label: agent.name },
    metadata: { scheduleId: current.id, fields: Object.keys(patch) },
  });
  return serialize(await loadSchedule(input));
}

export async function deleteSchedule(input: {
  workspaceId: string;
  agentId: string;
  scheduleId: string;
}) {
  const agent = await getAgent(input.workspaceId, input.agentId);
  const current = (await loadSchedule(input)).schedule;
  await db
    .delete(agentScheduleTable)
    .where(eq(agentScheduleTable.id, current.id));
  await recordAudit({
    workspaceId: input.workspaceId,
    action: "agent.schedule_deleted",
    target: { type: "agent", id: agent.id, label: agent.name },
    metadata: { scheduleId: current.id },
  });
  return { id: current.id };
}

/** Turns a schedule off for good, with the reason in the audit log. */
async function disableSchedule(row: ScheduleRow, reason: string) {
  const [updated] = await db
    .update(agentScheduleTable)
    .set({ enabled: false, nextRunAt: null })
    .where(eq(agentScheduleTable.id, row.id))
    .returning({ id: agentScheduleTable.id });
  if (!updated) return;
  const [agent] = await db
    .select({ name: agentTable.name })
    .from(agentTable)
    .where(eq(agentTable.id, row.agentId))
    .limit(1);
  await recordAudit({
    workspaceId: row.workspaceId,
    action: "agent.schedule_disabled",
    target: { type: "agent", id: row.agentId, label: agent?.name ?? null },
    metadata: { scheduleId: row.id, reason },
  });
}

/** Why a due schedule can't run now; null when it can. */
async function blocker(
  row: ScheduleRow,
): Promise<{ reason: string; disable: boolean } | null> {
  if (!row.createdBy) return { reason: "PRINCIPAL_LEFT", disable: true };
  const rights = await memberStatements(row.workspaceId, row.createdBy);
  if (!rights) return { reason: "PRINCIPAL_LEFT", disable: true };
  if (!satisfies(rights, { ai: ["use"] })) {
    return { reason: "AI_USE_DENIED", disable: true };
  }
  if (!(await canSeeProject(row.createdBy, row.projectId))) {
    return { reason: "NOT_IN_SCOPE", disable: true };
  }
  const [state] = await db
    .select({
      agentEnabled: agentTable.enabled,
      projectIds: agentTable.projectIds,
      aiEnabled: projectTable.aiEnabled,
      projectDeleted: projectTable.deletedAt,
    })
    .from(agentTable)
    .innerJoin(projectTable, eq(projectTable.id, row.projectId))
    .where(eq(agentTable.id, row.agentId))
    .limit(1);
  if (!state || state.projectDeleted) {
    return { reason: "NOT_IN_SCOPE", disable: true };
  }
  if (state.projectIds && !state.projectIds.includes(row.projectId)) {
    return { reason: "OUTSIDE_AGENT_PROJECTS", disable: true };
  }
  // Off for now, on again later: skip this slot, keep the schedule.
  if (!state.agentEnabled) return { reason: "AGENT_DISABLED", disable: false };
  if (!state.aiEnabled || !getAiInstanceConfig().enabled) {
    return { reason: "AI_DISABLED", disable: false };
  }
  if (!(await loadWorkspaceAiPolicy(row.workspaceId)).enabled) {
    return { reason: "AI_DISABLED", disable: false };
  }
  return null;
}

/**
 * Fires every due schedule once (scheduler, every minute). Each is
 * claimed by moving next_run_at from the value read to the next slot; an
 * instance that loses the race skips it. Missed slots (downtime) run once.
 */
export async function runAgentSchedules(now: Date = new Date()) {
  const due = await db
    .select()
    .from(agentScheduleTable)
    .where(
      and(
        eq(agentScheduleTable.enabled, true),
        lte(agentScheduleTable.nextRunAt, now),
      ),
    )
    .orderBy(asc(agentScheduleTable.nextRunAt))
    .limit(DUE_BATCH);
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of due) {
    if (!row.nextRunAt) continue;
    const next = nextRunAfter(row.cron, row.timezone, now);
    const [claimed] = await db
      .update(agentScheduleTable)
      .set({
        lastRunAt: now,
        nextRunAt: next,
        // A schedule that can never run again turns off.
        ...(next ? {} : { enabled: false }),
        updatedAt: row.updatedAt,
      })
      .where(
        and(
          eq(agentScheduleTable.id, row.id),
          eq(agentScheduleTable.enabled, true),
          eq(agentScheduleTable.nextRunAt, row.nextRunAt),
        ),
      )
      .returning({ id: agentScheduleTable.id });
    if (!claimed) continue;
    try {
      const blocked = await blocker(row);
      if (blocked) {
        skipped += 1;
        if (blocked.disable) await disableSchedule(row, blocked.reason);
        continue;
      }
      const run = await enqueueRun({
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        taskId: row.taskId,
        agentId: row.agentId,
        principalUserId: row.createdBy as string,
        trigger: "schedule",
        triggerRef: { scheduleId: row.id },
        // One run per slot, even if a claim were ever repeated.
        dedupeKey: `schedule:${row.id}:${row.nextRunAt.toISOString()}`,
        prompt: row.prompt,
      });
      if (run) queued += 1;
    } catch (error) {
      failed += 1;
      console.error("agents: a schedule failed to start", {
        scheduleId: row.id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return { due: due.length, queued, skipped, degraded: failed > 0 };
}
