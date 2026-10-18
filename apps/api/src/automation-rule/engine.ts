import { and, count, eq, gte, ne, sql } from "drizzle-orm";
import { auditContext } from "../audit-log/context";
import { recordAudit } from "../audit-log/record";
import db from "../database";
import {
  automationRuleTable,
  automationRunTable,
  userTable,
} from "../database/schema";
import { eventContext } from "../events";
import { type ActionResult, runActions } from "./actions";
import {
  type AutomationStore,
  automationContext,
  currentAutomation,
} from "./context";
import {
  conditionsHold,
  type RuleRefs,
  type TriggerEvent,
  triggerMatches,
} from "./evaluate";
import { loadColumns, loadTaskFacts } from "./facts";
import {
  type AutomationRuleDefinition,
  automationRuleDefinitionSchema,
} from "./vocabulary";

// The rule engine. Subscribers hand it trigger events; it finds the
// project's enabled rules for that trigger, checks conditions against the
// task as it is now and runs the actions as "Automation". It runs after the
// change that triggered it was committed and published, outside that
// request, so a failing run never undoes or fails a person's change.
//
// Loops: actions run inside an AsyncLocalStorage store that carries the
// chain of rules. A rule never re-triggers itself through its own chain,
// chains stop at MAX_DEPTH rules, and each task takes at most
// TASK_RATE_LIMIT runs a minute (across instances, counted in the run log).

export const MAX_DEPTH = 3;
export const TASK_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
/** How long a project's rule list is reused (single instance writes clear it). */
const RULE_CACHE_MS = 5_000;

export type EngineRule = {
  id: string;
  projectId: string;
  name: string;
  definition: AutomationRuleDefinition;
  /** Who last saved the rule: the person a run_agent action acts for. */
  ownerId: string | null;
};

type CacheEntry = { at: number; rules: EngineRule[] };
const ruleCache = new Map<string, CacheEntry>();

/** Forget cached rules (after a rule changes, and in tests). */
export function forgetAutomationRules(projectId?: string) {
  if (projectId) ruleCache.delete(projectId);
  else ruleCache.clear();
}

/** The project's enabled rules, parsed; invalid stored rules are skipped. */
export async function enabledRules(projectId: string): Promise<EngineRule[]> {
  const hit = ruleCache.get(projectId);
  if (hit && Date.now() - hit.at < RULE_CACHE_MS) return hit.rules;
  const rows = await db
    .select()
    .from(automationRuleTable)
    .where(
      and(
        eq(automationRuleTable.projectId, projectId),
        eq(automationRuleTable.enabled, true),
      ),
    );
  const rules = rows.flatMap((row): EngineRule[] => {
    const parsed = automationRuleDefinitionSchema.safeParse({
      name: row.name,
      trigger: row.trigger,
      conditions: row.conditions,
      actions: row.actions,
    });
    return parsed.success
      ? [
          {
            id: row.id,
            projectId: row.projectId,
            name: row.name,
            definition: parsed.data,
            ownerId: row.updatedBy ?? row.createdBy,
          },
        ]
      : [];
  });
  ruleCache.set(projectId, { at: Date.now(), rules });
  return rules;
}

// Runs started but not finished; tests and shutdown wait for them.
const pending = new Set<Promise<void>>();

export async function settleAutomationRuns(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}

/**
 * Queues an event for the engine. The work starts on the next turn of the
 * event loop, after the publisher's own code, and its errors are logged.
 */
export function enqueueTrigger(event: TriggerEvent, dedupeKey?: string) {
  const parent = currentAutomation();
  // Who made the change: subscribers run in the publisher's context.
  const initiatorId = eventContext.getStore()?.initiatorId ?? null;
  const job = new Promise<void>((resolve) => {
    setImmediate(() => {
      handleTrigger(event, parent, dedupeKey, initiatorId)
        .catch((error) => {
          console.error("Automation run failed:", error);
        })
        .finally(resolve);
    });
  });
  pending.add(job);
  void job.finally(() => pending.delete(job));
}

type RunOutcome = "success" | "partial" | "failed" | "skipped";

function outcomeOf(results: readonly ActionResult[]): RunOutcome {
  const failed = results.filter((result) => result.status === "failed").length;
  if (failed === 0) return "success";
  return failed === results.length ? "failed" : "partial";
}

async function recentRuns(taskId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(automationRunTable)
    .where(
      and(
        eq(automationRunTable.taskId, taskId),
        ne(automationRunTable.outcome, "skipped"),
        gte(
          automationRunTable.createdAt,
          new Date(Date.now() - RATE_WINDOW_MS),
        ),
      ),
    );
  return row?.value ?? 0;
}

async function logRun(input: {
  rule: EngineRule;
  taskId: string;
  triggerType: string;
  outcome: RunOutcome;
  error?: string | null;
  actions?: ActionResult[];
  depth: number;
  dedupeKey?: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(automationRunTable)
    .values({
      ruleId: input.rule.id,
      projectId: input.rule.projectId,
      taskId: input.taskId,
      triggerType: input.triggerType,
      outcome: input.outcome,
      error: input.error ?? null,
      actions: input.actions ?? null,
      depth: input.depth,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: automationRunTable.id });
  if (inserted.length === 0) return false;
  await db
    .update(automationRuleTable)
    .set({
      runCount: sql`${automationRuleTable.runCount} + 1`,
      failureCount:
        input.outcome === "failed" || input.outcome === "partial"
          ? sql`${automationRuleTable.failureCount} + 1`
          : automationRuleTable.failureCount,
      lastRunAt: new Date(),
      lastOutcome: input.outcome,
      // Counters are not an edit of the rule.
      updatedAt: sql`${automationRuleTable.updatedAt}`,
    })
    .where(eq(automationRuleTable.id, input.rule.id));
  return true;
}

/** Runs one rule's actions on one task as "Automation". */
async function execute(
  rule: EngineRule,
  event: TriggerEvent,
  store: AutomationStore,
  dedupeKey: string | undefined,
): Promise<void> {
  const task = await loadTaskFacts(event.taskId);
  if (!task) return;
  const columns = await loadColumns(task.projectId);
  const results = await runActions(
    rule.definition.actions,
    {
      task,
      columns,
      ruleName: rule.name,
      ruleId: rule.id,
      ruleOwnerId: rule.ownerId,
      causedByAgent: store.causedByAgent === true,
    },
    () => loadTaskFacts(event.taskId),
  );
  const outcome = outcomeOf(results);
  const logged = await logRun({
    rule,
    taskId: task.id,
    triggerType: event.type,
    outcome,
    error: results.find((result) => result.error)?.error ?? null,
    actions: results,
    depth: store.depth,
    dedupeKey,
  });
  if (!logged) return;
  if (results.some((result) => result.status === "applied")) {
    await recordAudit({
      workspaceId: task.workspaceId,
      action: "automation.rule_ran",
      target: {
        type: "task",
        id: task.id,
        label: `${task.projectSlug.toUpperCase()}-${task.number ?? 0}`,
      },
      metadata: {
        ruleId: rule.id,
        ruleName: rule.name,
        projectId: task.projectId,
        outcome,
        actions: results.map((result) => `${result.type}:${result.status}`),
      },
    });
  }
}

/**
 * Whether the person behind a change is an agent. Initiators are a user id,
 * optionally with ":<window id>" from the browser.
 */
async function isAgentInitiator(initiatorId: string | null): Promise<boolean> {
  const userId = initiatorId?.split(":")[0];
  if (!userId || userId === "automation") return false;
  const [row] = await db
    .select({ kind: userTable.kind })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.kind === "agent";
}

/** Matches an event against the project's rules and runs the ones that fit. */
export async function handleTrigger(
  event: TriggerEvent,
  parent: AutomationStore | null = null,
  dedupeKey?: string,
  initiatorId: string | null = null,
): Promise<void> {
  const rules = (await enabledRules(event.projectId)).filter(
    (rule) => rule.definition.trigger.type === event.type,
  );
  if (rules.length === 0) return;

  const depth = parent ? parent.depth + 1 : 0;
  const chain = parent?.chain ?? [];
  const columns = await loadColumns(event.projectId);
  const refs: RuleRefs = {
    columnSlugs: new Map(columns.map((column) => [column.id, column.slug])),
  };
  const matching = rules.filter(
    (rule) =>
      // Actions caused by a rule never trigger that rule again.
      !chain.includes(rule.id) &&
      triggerMatches(rule.definition.trigger, event, refs),
  );
  if (matching.length === 0) return;

  const task = await loadTaskFacts(event.taskId);
  // A rule only touches live tasks of its own project.
  if (
    !task ||
    task.projectId !== event.projectId ||
    task.deletedAt ||
    task.projectDeletedAt ||
    task.projectArchivedAt
  ) {
    return;
  }

  let causedByAgent: boolean | undefined;
  for (const rule of matching) {
    if (!conditionsHold(rule.definition.conditions, task, refs)) continue;
    if (depth >= MAX_DEPTH) {
      await logRun({
        rule,
        taskId: task.id,
        triggerType: event.type,
        outcome: "skipped",
        error: "LOOP_DEPTH",
        depth,
      });
      continue;
    }
    if ((await recentRuns(task.id)) >= TASK_RATE_LIMIT) {
      await logRun({
        rule,
        taskId: task.id,
        triggerType: event.type,
        outcome: "skipped",
        error: "RATE_LIMITED",
        depth,
      });
      continue;
    }
    causedByAgent ??=
      parent?.causedByAgent === true || (await isAgentInitiator(initiatorId));
    const store: AutomationStore = {
      ruleId: rule.id,
      ruleName: rule.name,
      projectId: rule.projectId,
      depth,
      chain: [...chain, rule.id],
      causedByAgent,
    };
    // Outside the triggering request (its actor, IP and API key are not
    // ours), with an initiator no browser has, so every viewer of the
    // project gets the realtime updates, the triggering person included.
    await auditContext.exit(() =>
      eventContext.run({ initiatorId: "automation" }, () =>
        automationContext.run(store, async () => {
          try {
            await execute(rule, event, store, dedupeKey);
          } catch (error) {
            console.error(`Automation rule ${rule.id} failed:`, error);
            await logRun({
              rule,
              taskId: task.id,
              triggerType: event.type,
              outcome: "failed",
              error: "INTERNAL_ERROR",
              depth,
            }).catch(() => undefined);
          }
        }),
      ),
    );
  }
}
