import { count, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  columnTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../../database/schema";
import { boundedTaskRead } from "../../task/bounded-read";
import { taskColumnJoin } from "../../task/scope";
import { resolveTimezone } from "../../utils/zoned-date";
import { type AutomationRule, ruleEligibility } from "../eligibility";

export const PREVIEW_CAP = 10_000;

/**
 * How many tasks the rule would take right now with these months (§3.3.4).
 * The auto-close column does not affect eligibility. Counts at most `cap`
 * tasks, so large projects stay cheap.
 */
export async function previewProjectAutomation({
  projectId,
  rule,
  months,
  now = new Date(),
  cap = PREVIEW_CAP,
}: {
  projectId: string;
  rule: AutomationRule;
  months: number;
  now?: Date;
  cap?: number;
}) {
  const matched = await boundedTaskRead(async (tx) => {
    const [project] = await tx
      .select({
        cyclesOn: projectTable.cyclesEnabled,
        modulesOn: projectTable.modulesEnabled,
        archivedAt: projectTable.archivedAt,
        timezone: workspaceTable.timezone,
      })
      .from(projectTable)
      .innerJoin(
        workspaceTable,
        eq(workspaceTable.id, projectTable.workspaceId),
      )
      .where(eq(projectTable.id, projectId))
      .limit(1);
    if (!project)
      throw new HTTPException(404, { message: "Project not found" });
    // The job skips archived projects (E1).
    if (project.archivedAt) return 0;
    const { cyclesOn, modulesOn } = project;
    const timezone = resolveTimezone(project.timezone);

    const candidates = tx
      .select({ one: sql`1`.as("one") })
      .from(taskTable)
      .leftJoin(columnTable, taskColumnJoin)
      .where(
        ruleEligibility(rule, {
          projectId,
          now,
          months,
          cyclesOn,
          modulesOn,
          timezone,
        }),
      )
      .limit(cap + 1)
      .as("candidates");
    const [row] = await tx.select({ value: count() }).from(candidates);
    return row?.value ?? 0;
  }, "Preview took too long; retry later");

  return {
    rule,
    months,
    count: Math.min(matched, cap),
    capped: matched > cap,
  };
}
