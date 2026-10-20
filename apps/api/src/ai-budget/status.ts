import { and, eq, gte, sql } from "drizzle-orm";
import { startOfUtcMonth, workspaceMonthSpendMicros } from "../ai/usage";
import { loadWorkspaceAiPolicy } from "../ai/workspace-settings";
import db from "../database";
import { notificationTable, workspaceUserTable } from "../database/schema";
import { notifySystem } from "../notification/system";
import {
  builtInRoleStatements,
  customRoleStatements,
} from "../utils/require-workspace-permission";

// The 80% warning of a workspace's monthly AI budget: a status the AI
// settings page shows as a banner, and one inbox notice (with its email,
// per each person's delivery settings) to everyone who manages AI, once per
// UTC month. The cap itself is enforced by the gateway (ai/usage.ts).

export const BUDGET_WARNING_PERCENT = 80;
export const AI_BUDGET_WARNING_TYPE = "ai_budget_warning";

export type BudgetStatus = {
  monthlyCapMicros: number | null;
  usedMicros: number;
  /** Whole percent of the cap used (may pass 100); null without a cap. */
  usedPercent: number | null;
  warning: boolean;
  /** The month the numbers are for, YYYY-MM (UTC). */
  month: string;
};

/** Pure: the status for a cap and a month's spend. */
export function budgetStatusOf(
  monthlyCapMicros: number | null,
  usedMicros: number,
  now: Date,
): BudgetStatus {
  const month = startOfUtcMonth(now).toISOString().slice(0, 7);
  if (monthlyCapMicros === null || monthlyCapMicros <= 0) {
    return {
      monthlyCapMicros: monthlyCapMicros ?? null,
      usedMicros,
      usedPercent: null,
      warning: false,
      month,
    };
  }
  const usedPercent = Math.floor((usedMicros / monthlyCapMicros) * 100);
  return {
    monthlyCapMicros,
    usedMicros,
    usedPercent,
    warning: usedPercent >= BUDGET_WARNING_PERCENT,
    month,
  };
}

export async function workspaceBudgetStatus(
  workspaceId: string,
  now = new Date(),
): Promise<BudgetStatus> {
  const policy = await loadWorkspaceAiPolicy(workspaceId);
  const used =
    policy.monthlyCapMicros === null
      ? 0
      : await workspaceMonthSpendMicros(workspaceId, now);
  return budgetStatusOf(policy.monthlyCapMicros, used, now);
}

/** Members whose role lets them manage AI (ai:manage). */
export async function aiManagerIds(workspaceId: string): Promise<string[]> {
  const members = await db
    .select({
      userId: workspaceUserTable.userId,
      role: workspaceUserTable.role,
    })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  const byRole = new Map<string, boolean>();
  const ids: string[] = [];
  for (const member of members) {
    let allowed = byRole.get(member.role);
    if (allowed === undefined) {
      const statements =
        (await customRoleStatements(workspaceId, member.role)) ??
        builtInRoleStatements(member.role);
      allowed = Boolean(statements?.ai?.includes("manage"));
      byRole.set(member.role, allowed);
    }
    if (allowed) ids.push(member.userId);
  }
  return ids;
}

// Months already warned about in this process, so a busy workspace checks
// the database once per month, not once per call.
const warned = new Set<string>();

/** Test hook: forget what this process already warned about. */
export function resetBudgetWarnings(): void {
  warned.clear();
}

/**
 * After a call was recorded: when the month's spend has passed 80% of the
 * cap and nobody was warned this month, notify everyone who manages AI.
 * Returns how many people were notified. Never throws.
 */
export async function maybeWarnBudget(
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  try {
    const status = await workspaceBudgetStatus(workspaceId, now);
    if (!status.warning || status.usedPercent === null) return 0;
    const key = `${workspaceId}:${status.month}`;
    if (warned.has(key)) return 0;
    warned.add(key);

    // Once per month across instances: a notice of this type this month.
    const [already] = await db
      .select({ id: notificationTable.id })
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.workspaceId, workspaceId),
          eq(notificationTable.type, AI_BUDGET_WARNING_TYPE),
          gte(notificationTable.createdAt, startOfUtcMonth(now)),
          sql`${notificationTable.eventData}->>'month' = ${status.month}`,
        ),
      )
      .limit(1);
    if (already) return 0;

    let sent = 0;
    for (const userId of await aiManagerIds(workspaceId)) {
      const notification = await notifySystem({
        userId,
        type: AI_BUDGET_WARNING_TYPE,
        // English fallbacks for email and digests; the web renders the type.
        title: "AI budget almost used",
        content: `This workspace has used ${status.usedPercent}% of its monthly AI budget.`,
        eventData: {
          month: status.month,
          usedPercent: status.usedPercent,
          workspaceId,
        },
        resourceId: workspaceId,
        resourceType: "workspace",
      });
      if (notification) sent++;
    }
    return sent;
  } catch (error) {
    console.error("AI budget warning failed", { workspaceId, error });
    return 0;
  }
}
