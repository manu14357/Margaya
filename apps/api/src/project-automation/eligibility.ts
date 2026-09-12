import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  cycleTable,
  cycleTaskTable,
  moduleTable,
  moduleTaskTable,
  taskTable,
} from "../database/schema";
import { taskGroupSql } from "../task/scope";
import { DEFAULT_TIMEZONE, todayInTimezone } from "../utils/zoned-date";
import { automationCutoff, upcomingDateGrace } from "./cutoff";

// The tasks each rule takes (§3.4.3), as SQL shared by the preview and the
// job. Callers select from `task` LEFT JOIN `column` ON taskColumnJoin (for
// the group) and check separately that the project is not archived.

export type AutomationRule = "archive" | "close";

export type EligibilityInput = {
  projectId: string;
  now: Date;
  months: number;
  /** Membership guards apply only while the feature is on. */
  cyclesOn: boolean;
  modulesOn: boolean;
  /** The workspace's IANA zone; "today" and the cutoff follow it. */
  timezone?: string;
};

/** E4: in a cycle of the project that is not completed yet. */
function inRunningCycle(today: string): SQL {
  return sql`exists (
    select 1 from ${cycleTaskTable}
    inner join ${cycleTable} on ${cycleTable.id} = ${cycleTaskTable.cycleId}
    where ${cycleTaskTable.taskId} = ${taskTable.id}
      and ${cycleTable.projectId} = ${taskTable.projectId}
      and ${or(isNull(cycleTable.endDate), gte(cycleTable.endDate, today))}
  )`;
}

/** E5: in a module of the project that is still running. */
function inRunningModule(today: string): SQL {
  return sql`exists (
    select 1 from ${moduleTaskTable}
    inner join ${moduleTable} on ${moduleTable.id} = ${moduleTaskTable.moduleId}
    where ${moduleTaskTable.taskId} = ${taskTable.id}
      and ${moduleTable.projectId} = ${taskTable.projectId}
      and ${isNull(moduleTable.archivedAt)}
      and ${notInArray(moduleTable.status, ["completed", "cancelled"])}
      and ${or(isNull(moduleTable.targetDate), gte(moduleTable.targetDate, today))}
  )`;
}

/** E1 (the project half), E2 to E5. */
function commonEligibility(input: EligibilityInput): SQL {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const today = todayInTimezone(timezone, input.now);
  return and(
    eq(taskTable.projectId, input.projectId),
    isNull(taskTable.archivedAt),
    // Trashed tasks are left alone (C7).
    isNull(taskTable.deletedAt),
    lte(
      taskTable.updatedAt,
      automationCutoff(input.now, input.months, timezone),
    ),
    input.cyclesOn ? sql`not ${inRunningCycle(today)}` : undefined,
    input.modulesOn ? sql`not ${inRunningModule(today)}` : undefined,
  ) as SQL;
}

/** Auto-archive: closed tasks (completed or cancelled group). */
export function archiveEligibility(input: EligibilityInput): SQL {
  return and(
    commonEligibility(input),
    inArray(taskGroupSql, ["completed", "cancelled"]),
  ) as SQL;
}

/**
 * Auto-close: open tasks (planned counts as backlog; triage is neither open
 * nor closed) with no start or due date still ahead.
 */
export function closeEligibility(input: EligibilityInput): SQL {
  const grace = upcomingDateGrace(input.now);
  return and(
    commonEligibility(input),
    inArray(taskGroupSql, ["backlog", "unstarted", "started"]),
    or(isNull(taskTable.startDate), lt(taskTable.startDate, grace)),
    or(isNull(taskTable.dueDate), lt(taskTable.dueDate, grace)),
  ) as SQL;
}

export function ruleEligibility(
  rule: AutomationRule,
  input: EligibilityInput,
): SQL {
  return rule === "archive"
    ? archiveEligibility(input)
    : closeEligibility(input);
}
