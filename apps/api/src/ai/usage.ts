import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { maybeWarnBudget } from "../ai-budget/status";
import db from "../database";
import {
  aiFeedbackTable,
  aiUsageTable,
  userTable,
  workspaceTable,
} from "../database/schema";
import { aiCalls, aiCost, aiTokens } from "../observability/instruments";
import { recordFailure } from "../observability/jobs";
import { CSV_BOM, csvLine } from "../task-export/encoders/csv";
import { AiError } from "./errors";
import type { AiFeature } from "./features";
import type { DataTier, ModelTier, ProviderId, TokenUsage } from "./types";
import type { WorkspaceAiPolicy } from "./workspace-settings";

// The AI Ledger (B3): one ai_usage row per model call, written by the
// gateway after the call, and the budget checks it runs before one.
// Caps use UTC calendar months and days.

export type UsageStatus = "ok" | "error" | "refused" | "cancelled";

export type UsageRecord = {
  workspaceId: string;
  userId: string | null;
  agentId?: string | null;
  runId?: string | null;
  feature: AiFeature;
  provider: ProviderId;
  model: string;
  tier: ModelTier;
  dataTier: DataTier;
  status: UsageStatus;
  usage: TokenUsage;
  costMicros: number;
  durationMs: number;
};

/** The ledger row's counts as metrics; never a workspace, user or model. */
function countAiUsage(record: UsageRecord): void {
  const provider = record.provider;
  aiCalls.inc({ feature: record.feature, provider, status: record.status });
  aiTokens.inc({ provider, kind: "input" }, record.usage.input);
  aiTokens.inc({ provider, kind: "output" }, record.usage.output);
  aiTokens.inc({ provider, kind: "cache_read" }, record.usage.cacheRead);
  aiTokens.inc({ provider, kind: "cache_write" }, record.usage.cacheWrite);
  aiCost.inc({ provider }, record.costMicros);
  if (record.status === "error") {
    recordFailure("ai", `${record.feature} (${provider})`);
  }
}

export async function recordAiUsage(record: UsageRecord): Promise<void> {
  countAiUsage(record);
  await db.insert(aiUsageTable).values({
    workspaceId: record.workspaceId,
    userId: record.userId,
    agentId: record.agentId ?? null,
    runId: record.runId ?? null,
    feature: record.feature,
    provider: record.provider,
    model: record.model,
    tier: record.tier,
    dataTier: record.dataTier,
    status: record.status,
    inputTokens: record.usage.input,
    outputTokens: record.usage.output,
    cacheReadTokens: record.usage.cacheRead,
    cacheWriteTokens: record.usage.cacheWrite,
    costMicros: record.costMicros,
    durationMs: Math.max(0, Math.round(record.durationMs)),
  });
  // The 80% budget notice for AI managers (once a month); off the hot path.
  if (record.costMicros > 0) void maybeWarnBudget(record.workspaceId);
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function secondsUntil(date: Date, now: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
}

export type BudgetState = {
  monthlyCapMicros: number | null;
  monthSpendMicros: number;
  userDailyCapTokens: number | null;
  userDayTokens: number;
};

/** Pure: which cap, if any, blocks the next call. */
export function budgetBlock(
  state: BudgetState,
): "workspace_month" | "user_day" | null {
  if (
    state.monthlyCapMicros !== null &&
    state.monthSpendMicros >= state.monthlyCapMicros
  ) {
    return "workspace_month";
  }
  if (
    state.userDailyCapTokens !== null &&
    state.userDayTokens >= state.userDailyCapTokens
  ) {
    return "user_day";
  }
  return null;
}

export async function workspaceMonthSpendMicros(
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${aiUsageTable.costMicros}), 0)`,
    })
    .from(aiUsageTable)
    .where(
      and(
        eq(aiUsageTable.workspaceId, workspaceId),
        gte(aiUsageTable.createdAt, startOfUtcMonth(now)),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function userDayTokens(
  workspaceId: string,
  userId: string,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${aiUsageTable.inputTokens} + ${aiUsageTable.outputTokens}), 0)`,
    })
    .from(aiUsageTable)
    .where(
      and(
        eq(aiUsageTable.workspaceId, workspaceId),
        eq(aiUsageTable.userId, userId),
        gte(aiUsageTable.createdAt, startOfUtcDay(now)),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Throws AI_BUDGET_EXCEEDED when a cap is reached. Cheap when no caps. */
export async function assertWithinBudget(input: {
  workspaceId: string;
  userId: string | null;
  policy: Pick<WorkspaceAiPolicy, "monthlyCapMicros" | "userDailyCapTokens">;
  now?: Date;
}): Promise<void> {
  const { policy, workspaceId, userId } = input;
  const now = input.now ?? new Date();
  if (policy.monthlyCapMicros === null && policy.userDailyCapTokens === null) {
    return;
  }
  const state: BudgetState = {
    monthlyCapMicros: policy.monthlyCapMicros,
    monthSpendMicros:
      policy.monthlyCapMicros === null
        ? 0
        : await workspaceMonthSpendMicros(workspaceId, now),
    userDailyCapTokens: userId ? policy.userDailyCapTokens : null,
    userDayTokens:
      userId && policy.userDailyCapTokens !== null
        ? await userDayTokens(workspaceId, userId, now)
        : 0,
  };
  const block = budgetBlock(state);
  if (block === "workspace_month") {
    const next = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    throw new AiError(
      "AI_BUDGET_EXCEEDED",
      "This workspace has reached its monthly AI budget",
      { retryAfterSeconds: secondsUntil(next, now) },
    );
  }
  if (block === "user_day") {
    const next = new Date(startOfUtcDay(now).getTime() + 86_400_000);
    throw new AiError(
      "AI_BUDGET_EXCEEDED",
      "You have reached your daily AI limit in this workspace",
      { retryAfterSeconds: secondsUntil(next, now) },
    );
  }
}

// --- Usage summaries (admin pages) ---

const totals = {
  calls: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${aiUsageTable.inputTokens}), 0)::bigint`,
  outputTokens: sql<number>`coalesce(sum(${aiUsageTable.outputTokens}), 0)::bigint`,
  costMicros: sql<number>`coalesce(sum(${aiUsageTable.costMicros}), 0)::bigint`,
};

type Totals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
};

function numbers<T extends Totals>(row: T): T {
  return {
    ...row,
    calls: Number(row.calls),
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costMicros: Number(row.costMicros),
  };
}

const day = sql<string>`to_char(date_trunc('day', ${aiUsageTable.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

export type UsageRange = { from: Date; to: Date };

export type FeedbackSummary = {
  up: number;
  down: number;
  byFeature: { feature: string; up: number; down: number }[];
};

/** Thumbs up and down given in [from, to), in total and by feature. */
export async function workspaceFeedbackSummary(
  workspaceId: string,
  range: UsageRange,
): Promise<FeedbackSummary> {
  const rows = await db
    .select({
      feature: aiFeedbackTable.feature,
      up: sql<number>`(count(*) filter (where ${aiFeedbackTable.rating} > 0))::int`,
      down: sql<number>`(count(*) filter (where ${aiFeedbackTable.rating} < 0))::int`,
    })
    .from(aiFeedbackTable)
    .where(
      and(
        eq(aiFeedbackTable.workspaceId, workspaceId),
        gte(aiFeedbackTable.createdAt, range.from),
        lt(aiFeedbackTable.createdAt, range.to),
      ),
    )
    .groupBy(aiFeedbackTable.feature)
    .orderBy(aiFeedbackTable.feature);
  const byFeature = rows.map((row) => ({
    feature: row.feature,
    up: Number(row.up),
    down: Number(row.down),
  }));
  return {
    up: byFeature.reduce((sum, row) => sum + row.up, 0),
    down: byFeature.reduce((sum, row) => sum + row.down, 0),
    byFeature,
  };
}

/** Rows of the usage CSV: one per UTC day, feature, model and person. */
export const MAX_USAGE_EXPORT_ROWS = 50_000;

/**
 * The workspace's usage in [from, to) as CSV (UTF-8 with a byte-order mark,
 * the dialect of every Margaya CSV): day, feature, provider, model, person,
 * calls, tokens and list-price cost. Counts only, like the ledger.
 */
export async function workspaceUsageCsv(
  workspaceId: string,
  range: UsageRange,
): Promise<string> {
  const rows = await db
    .select({
      day,
      feature: aiUsageTable.feature,
      provider: aiUsageTable.provider,
      model: aiUsageTable.model,
      userId: aiUsageTable.userId,
      name: userTable.name,
      ...totals,
    })
    .from(aiUsageTable)
    .leftJoin(userTable, eq(userTable.id, aiUsageTable.userId))
    .where(
      and(
        eq(aiUsageTable.workspaceId, workspaceId),
        gte(aiUsageTable.createdAt, range.from),
        lt(aiUsageTable.createdAt, range.to),
      ),
    )
    .groupBy(
      day,
      aiUsageTable.feature,
      aiUsageTable.provider,
      aiUsageTable.model,
      aiUsageTable.userId,
      userTable.name,
    )
    .orderBy(day, aiUsageTable.feature, aiUsageTable.model)
    .limit(MAX_USAGE_EXPORT_ROWS);
  const lines = [
    csvLine([
      "day",
      "feature",
      "provider",
      "model",
      "user_id",
      "user",
      "calls",
      "input_tokens",
      "output_tokens",
      "cost_usd",
    ]),
    ...rows.map((row) =>
      csvLine([
        row.day,
        row.feature,
        row.provider,
        row.model,
        row.userId,
        row.name,
        Number(row.calls),
        Number(row.inputTokens),
        Number(row.outputTokens),
        Number(row.costMicros) / 1_000_000,
      ]),
    ),
  ];
  return `${CSV_BOM}${lines.join("")}`;
}

/** A workspace's usage in [from, to): totals and four breakdowns. */
export async function workspaceUsageSummary(
  workspaceId: string,
  range: UsageRange,
) {
  const where = and(
    eq(aiUsageTable.workspaceId, workspaceId),
    gte(aiUsageTable.createdAt, range.from),
    lt(aiUsageTable.createdAt, range.to),
  );
  const [total, byFeature, byModel, byUser, byDay, feedback] =
    await Promise.all([
      db.select(totals).from(aiUsageTable).where(where),
      db
        .select({ feature: aiUsageTable.feature, ...totals })
        .from(aiUsageTable)
        .where(where)
        .groupBy(aiUsageTable.feature)
        .orderBy(desc(totals.costMicros), desc(totals.calls)),
      db
        .select({
          provider: aiUsageTable.provider,
          model: aiUsageTable.model,
          ...totals,
        })
        .from(aiUsageTable)
        .where(where)
        .groupBy(aiUsageTable.provider, aiUsageTable.model)
        .orderBy(desc(totals.costMicros), desc(totals.calls)),
      db
        .select({
          userId: aiUsageTable.userId,
          name: userTable.name,
          ...totals,
        })
        .from(aiUsageTable)
        .leftJoin(userTable, eq(userTable.id, aiUsageTable.userId))
        .where(where)
        .groupBy(aiUsageTable.userId, userTable.name)
        .orderBy(desc(totals.costMicros), desc(totals.calls))
        .limit(100),
      db
        .select({ day, ...totals })
        .from(aiUsageTable)
        .where(where)
        .groupBy(day)
        .orderBy(day),
      workspaceFeedbackSummary(workspaceId, range),
    ]);
  return {
    from: range.from,
    to: range.to,
    totals: numbers(
      total[0] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
    ),
    byFeature: byFeature.map(numbers),
    byModel: byModel.map(numbers),
    byUser: byUser.map((row) => numbers({ ...row, name: row.name ?? null })),
    byDay: byDay.map(numbers),
    feedback,
  };
}

/** Every workspace's usage in [from, to), for instance admins. */
export async function instanceUsageSummary(range: UsageRange) {
  const where = and(
    gte(aiUsageTable.createdAt, range.from),
    lt(aiUsageTable.createdAt, range.to),
  );
  const [total, byWorkspace, byModel, byDay] = await Promise.all([
    db.select(totals).from(aiUsageTable).where(where),
    db
      .select({
        workspaceId: aiUsageTable.workspaceId,
        name: workspaceTable.name,
        ...totals,
      })
      .from(aiUsageTable)
      .innerJoin(
        workspaceTable,
        eq(workspaceTable.id, aiUsageTable.workspaceId),
      )
      .where(where)
      .groupBy(aiUsageTable.workspaceId, workspaceTable.name)
      .orderBy(desc(totals.costMicros), desc(totals.calls))
      .limit(100),
    db
      .select({
        provider: aiUsageTable.provider,
        model: aiUsageTable.model,
        ...totals,
      })
      .from(aiUsageTable)
      .where(where)
      .groupBy(aiUsageTable.provider, aiUsageTable.model)
      .orderBy(desc(totals.costMicros), desc(totals.calls)),
    db
      .select({ day, ...totals })
      .from(aiUsageTable)
      .where(where)
      .groupBy(day)
      .orderBy(day),
  ]);
  return {
    from: range.from,
    to: range.to,
    totals: numbers(
      total[0] ?? { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 },
    ),
    byWorkspace: byWorkspace.map(numbers),
    byModel: byModel.map(numbers),
    byDay: byDay.map(numbers),
  };
}
