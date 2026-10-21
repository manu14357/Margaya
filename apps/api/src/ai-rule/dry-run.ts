import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  ne,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { pendingScopeTaskIds } from "../cycle/queries";
import db from "../database";
import {
  activityTable,
  columnTable,
  cycleTable,
  externalLinkTable,
  integrationTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import {
  loadAutomationRow,
  settingsOf,
} from "../project-automation/controllers/get-automations";
import {
  type AutomationRule,
  ruleEligibility,
} from "../project-automation/eligibility";
import { mergeAutomationPatch } from "../project-automation/settings";
import { boundedTaskRead } from "../task/bounded-read";
import { taskColumnJoin } from "../task/scope";
import { resolveTimezone, todayInTimezone } from "../utils/zoned-date";
import { replayAutomationRule } from "./automation-replay";
import type { DryRunMatch, DryRunNote } from "./response";
import {
  eventsFromLinks,
  RESOURCE_OF,
  type SimTask,
  type StatusChange,
  simulateWorkflowRule,
  sortMatches,
  thresholdCrossedAt,
} from "./simulate";
import { checkTaskRuleReferences, validateCompiledRule } from "./validate";
import type {
  CompiledAutomation,
  CompiledRule,
  CompiledWorkflowRule,
} from "./vocabulary";

// The dry run: replays a compiled rule over the project's recorded history
// and reports what it would have changed. Computed only; no model call and
// no writes, so it works whether AI is on or off.

/** Matches listed in the answer; `total` counts all of them. */
export const DRY_RUN_LIST_CAP = 200;
/** History rows read per run, so large projects stay cheap. */
const SCAN_CAP = 5000;
const SLOW = "Dry run took too long; try fewer days";

type ProjectInfo = {
  id: string;
  slug: string;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  archivedAt: Date | null;
  timezone: string;
};

async function loadProject(projectId: string): Promise<ProjectInfo> {
  const [project] = await db
    .select({
      id: projectTable.id,
      slug: projectTable.slug,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      archivedAt: projectTable.archivedAt,
      timezone: workspaceTable.timezone,
    })
    .from(projectTable)
    .innerJoin(workspaceTable, eq(workspaceTable.id, projectTable.workspaceId))
    .where(and(eq(projectTable.id, projectId), isNull(projectTable.deletedAt)))
    .limit(1);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return { ...project, timezone: resolveTimezone(project.timezone) };
}

export async function loadProjectColumns(projectId: string) {
  return db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      name: columnTable.name,
      group: columnTable.group,
      isFinal: columnTable.isFinal,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));
}

async function dryRunWorkflowRule(
  project: ProjectInfo,
  compiled: CompiledWorkflowRule,
  from: Date,
  to: Date,
) {
  const { rule } = compiled;
  const notes: DryRunNote[] = [];
  const [integration] = await db
    .select({ isActive: integrationTable.isActive })
    .from(integrationTable)
    .where(
      and(
        eq(integrationTable.projectId, project.id),
        eq(integrationTable.type, rule.integrationType),
      ),
    )
    .limit(1);
  if (!integration?.isActive) notes.push("integration_not_connected");
  if (rule.eventType === "branch_push") notes.push("branch_push_last_only");

  const columns = await loadProjectColumns(project.id);
  const { links, tasks, histories } = await boundedTaskRead(async (tx) => {
    const linkRows = await tx
      .select({
        taskId: externalLinkTable.taskId,
        metadata: externalLinkTable.metadata,
        createdAt: externalLinkTable.createdAt,
        updatedAt: externalLinkTable.updatedAt,
      })
      .from(externalLinkTable)
      .innerJoin(
        integrationTable,
        eq(integrationTable.id, externalLinkTable.integrationId),
      )
      .innerJoin(taskTable, eq(taskTable.id, externalLinkTable.taskId))
      .where(
        and(
          eq(integrationTable.projectId, project.id),
          eq(integrationTable.type, rule.integrationType),
          eq(taskTable.projectId, project.id),
          isNull(taskTable.deletedAt),
          eq(externalLinkTable.resourceType, RESOURCE_OF[rule.eventType]),
          // Every event time lies between creation and the last update.
          gte(externalLinkTable.updatedAt, from),
        ),
      )
      .orderBy(desc(externalLinkTable.updatedAt))
      .limit(SCAN_CAP);
    const taskIds = [...new Set(linkRows.map((link) => link.taskId))];
    if (taskIds.length === 0) {
      return { links: linkRows, tasks: [], histories: [] };
    }
    const taskRows = await tx
      .select({
        id: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
      })
      .from(taskTable)
      .where(inArray(taskTable.id, taskIds));
    const historyRows = await tx
      .select({
        taskId: activityTable.taskId,
        at: activityTable.createdAt,
        eventData: activityTable.eventData,
      })
      .from(activityTable)
      .where(
        and(
          inArray(activityTable.taskId, taskIds),
          eq(activityTable.type, "status_changed"),
          gte(activityTable.createdAt, from),
        ),
      )
      .orderBy(asc(activityTable.createdAt));
    return { links: linkRows, tasks: taskRows, histories: historyRows };
  }, SLOW);

  const historyByTask = new Map<string, StatusChange[]>();
  for (const row of histories) {
    const data = (row.eventData ?? {}) as Record<string, unknown>;
    const list = historyByTask.get(row.taskId) ?? [];
    list.push({
      at: row.at,
      oldStatus: typeof data.oldStatus === "string" ? data.oldStatus : null,
      newStatus: typeof data.newStatus === "string" ? data.newStatus : null,
    });
    historyByTask.set(row.taskId, list);
  }

  const matches = simulateWorkflowRule({
    rule,
    events: eventsFromLinks(rule.eventType, links),
    tasks: new Map<string, SimTask>(tasks.map((task) => [task.id, task])),
    histories: historyByTask,
    columns,
    from,
    to,
  });
  return { matches, notes };
}

async function eligibleTasks(
  project: ProjectInfo,
  rule: AutomationRule,
  months: number,
  now: Date,
) {
  // The job skips archived projects.
  if (project.archivedAt) return [];
  return boundedTaskRead(
    (tx) =>
      tx
        .select({
          id: taskTable.id,
          number: taskTable.number,
          title: taskTable.title,
          updatedAt: taskTable.updatedAt,
          columnName: columnTable.name,
          status: taskTable.status,
        })
        .from(taskTable)
        .leftJoin(columnTable, taskColumnJoin)
        .where(
          ruleEligibility(rule, {
            projectId: project.id,
            now,
            months,
            cyclesOn: project.cyclesEnabled,
            modulesOn: project.modulesEnabled,
            timezone: project.timezone,
          }),
        )
        .orderBy(desc(taskTable.updatedAt))
        .limit(SCAN_CAP),
    SLOW,
  );
}

async function rolloverMatches(
  project: ProjectInfo,
  from: Date,
  now: Date,
): Promise<DryRunMatch[]> {
  const today = todayInTimezone(project.timezone, now);
  const fromDay = todayInTimezone(project.timezone, from);
  const ended = await db
    .select({
      id: cycleTable.id,
      name: cycleTable.name,
      endDate: cycleTable.endDate,
    })
    .from(cycleTable)
    .where(
      and(
        eq(cycleTable.projectId, project.id),
        isNull(cycleTable.archivedAt),
        gte(cycleTable.endDate, fromDay),
        lt(cycleTable.endDate, today),
      ),
    )
    .orderBy(asc(cycleTable.endDate));

  const matches: DryRunMatch[] = [];
  for (const cycle of ended) {
    if (!cycle.endDate) continue;
    const [next] = await db
      .select({ name: cycleTable.name })
      .from(cycleTable)
      .where(
        and(
          eq(cycleTable.projectId, project.id),
          ne(cycleTable.id, cycle.id),
          isNull(cycleTable.archivedAt),
          gt(cycleTable.startDate, cycle.endDate),
          gte(cycleTable.endDate, today),
        ),
      )
      .orderBy(asc(cycleTable.startDate), asc(cycleTable.id))
      .limit(1);
    const taskIds = await pendingScopeTaskIds(db, cycle.id);
    if (taskIds.length === 0) continue;
    const tasks = await db
      .select({
        id: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
      })
      .from(taskTable)
      .where(inArray(taskTable.id, taskIds.slice(0, SCAN_CAP)));
    for (const task of tasks) {
      matches.push({
        taskId: task.id,
        taskNumber: task.number,
        title: task.title,
        at: `${cycle.endDate}T23:59:59.000Z`,
        kind: "rollover",
        outcome: next ? "change" : "skipped",
        from: cycle.name,
        to: next?.name ?? null,
      });
    }
  }
  return matches;
}

async function dryRunAutomation(
  project: ProjectInfo,
  compiled: CompiledAutomation,
  from: Date,
  now: Date,
) {
  const { patch } = compiled;
  const current = settingsOf(await loadAutomationRow(project.id));
  const { next } = mergeAutomationPatch(current, patch);
  const notes: DryRunNote[] = [];
  const matches: DryRunMatch[] = [];
  let simulated = false;

  if (patch.autoArchive && next.autoArchiveEnabled) {
    simulated = true;
    const rows = await eligibleTasks(
      project,
      "archive",
      next.autoArchiveMonths,
      now,
    );
    for (const row of rows) {
      matches.push({
        taskId: row.id,
        taskNumber: row.number,
        title: row.title,
        at: thresholdCrossedAt(
          row.updatedAt,
          next.autoArchiveMonths,
        ).toISOString(),
        kind: "archive",
        outcome: "change",
        from: row.columnName ?? row.status,
        to: null,
      });
    }
  }

  if (patch.autoClose && next.autoCloseEnabled) {
    simulated = true;
    const columns = await loadProjectColumns(project.id);
    const target = columns.find(
      (column) =>
        column.id === next.autoCloseColumnId && column.group === "cancelled",
    );
    const rows = await eligibleTasks(
      project,
      "close",
      next.autoCloseMonths,
      now,
    );
    for (const row of rows) {
      matches.push({
        taskId: row.id,
        taskNumber: row.number,
        title: row.title,
        at: thresholdCrossedAt(
          row.updatedAt,
          next.autoCloseMonths,
        ).toISOString(),
        kind: "close",
        // A paused auto-close (no valid column) takes nothing.
        outcome: target ? "change" : "skipped",
        from: row.columnName ?? row.status,
        to: target?.name ?? null,
      });
    }
  }
  if (simulated) notes.push("threshold_from_last_update");

  if (
    patch.cycleRollover &&
    next.cycleRolloverEnabled &&
    project.cyclesEnabled
  ) {
    simulated = true;
    matches.push(...(await rolloverMatches(project, from, now)));
  }

  if (patch.flowAlerts && next.flowAlertsEnabled) {
    simulated = true;
    notes.push("flow_alerts_notify_only");
  }
  if (!simulated) notes.push("nothing_enabled");
  return { matches, notes };
}

/** POST /ai/rules/dry-run */
export async function dryRunRule(input: {
  projectId: string;
  rule: CompiledRule;
  days: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - input.days * 86_400_000);
  const project = await loadProject(input.projectId);
  const columns = await loadProjectColumns(project.id);
  const issues = [
    ...validateCompiledRule(input.rule, columns),
    ...(await checkTaskRuleReferences(project.id, input.rule)),
  ];
  if (issues.length > 0) {
    throw new HTTPException(400, { message: issues.join("; ") });
  }

  const { matches, notes } =
    input.rule.engine === "workflow_rule"
      ? await dryRunWorkflowRule(project, input.rule, from, now)
      : input.rule.engine === "automation_rule"
        ? {
            matches: await replayAutomationRule({
              rule: input.rule.rule,
              projectId: project.id,
              columns,
              from,
              to: now,
            }),
            notes: ["conditions_current_state"] as DryRunNote[],
          }
        : await dryRunAutomation(project, input.rule, from, now);
  const sorted = sortMatches(matches);

  return {
    projectId: project.id,
    projectSlug: project.slug,
    engine: input.rule.engine,
    days: input.days,
    from: from.toISOString(),
    to: now.toISOString(),
    total: sorted.length,
    changed: sorted.filter((match) => match.outcome === "change").length,
    capped: sorted.length > DRY_RUN_LIST_CAP,
    matches: sorted.slice(0, DRY_RUN_LIST_CAP),
    notes,
  };
}
