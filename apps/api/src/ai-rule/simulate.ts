import type { DryRunMatch } from "./response";
import type { RuleEventType } from "./vocabulary";

// Pure replay of a compiled rule over recorded history (no model, no
// writes). The loaders in dry-run.ts read the rows; these functions decide
// what the engine would have done with them.

export type StatusChange = {
  at: Date;
  oldStatus: string | null;
  newStatus: string | null;
};

export type SimTask = {
  id: string;
  number: number | null;
  title: string;
  /** Current status (a column slug). */
  status: string;
};

export type SimColumn = {
  id: string;
  slug: string;
  name: string;
  isFinal: boolean;
};

export type IntegrationEvent = {
  taskId: string;
  at: Date;
  eventType: RuleEventType;
};

/**
 * A task's status at a moment: the old status of the first change after
 * it, or the current status when nothing changed since. `history` is
 * sorted oldest first.
 */
export function statusAt(
  current: string,
  history: readonly StatusChange[],
  at: Date,
): string {
  const next = history.find((change) => change.at.getTime() > at.getTime());
  return next?.oldStatus ?? current;
}

// The webhooks leave a task alone when it sits in a final column on these
// events (plugins/*/webhooks/pull-request-opened.ts and push.ts).
const SKIPS_FINAL: ReadonlySet<RuleEventType> = new Set([
  "pr_opened",
  "branch_push",
]);

/** What a workflow rule would have done on each event, newest first. */
export function simulateWorkflowRule(input: {
  rule: { eventType: RuleEventType; columnId: string };
  events: readonly IntegrationEvent[];
  tasks: ReadonlyMap<string, SimTask>;
  histories: ReadonlyMap<string, readonly StatusChange[]>;
  columns: readonly SimColumn[];
  from: Date;
  to: Date;
}): DryRunMatch[] {
  const target = input.columns.find(
    (column) => column.id === input.rule.columnId,
  );
  if (!target) return [];
  const bySlug = new Map(input.columns.map((column) => [column.slug, column]));

  const matches: DryRunMatch[] = [];
  for (const event of input.events) {
    if (event.eventType !== input.rule.eventType) continue;
    if (event.at < input.from || event.at > input.to) continue;
    const task = input.tasks.get(event.taskId);
    if (!task) continue;
    const before = statusAt(
      task.status,
      input.histories.get(task.id) ?? [],
      event.at,
    );
    const column = bySlug.get(before);
    const outcome: DryRunMatch["outcome"] =
      before === target.slug
        ? "unchanged"
        : SKIPS_FINAL.has(event.eventType) && column?.isFinal
          ? "skipped"
          : "change";
    matches.push({
      taskId: task.id,
      taskNumber: task.number,
      title: task.title,
      at: event.at.toISOString(),
      kind: "move",
      outcome,
      from: column?.name ?? before,
      to: target.name,
    });
  }
  return sortMatches(matches);
}

/**
 * When a task crosses an N-months-without-updates threshold: its last
 * update plus N calendar months (day clamped to the month's end), the
 * inverse of project-automation/cutoff.ts in UTC.
 */
export function thresholdCrossedAt(updatedAt: Date, months: number): Date {
  const target = new Date(updatedAt.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Newest first, then by task number. */
export function sortMatches(matches: DryRunMatch[]): DryRunMatch[] {
  return matches.sort((a, b) => {
    const byTime = (b.at ?? "").localeCompare(a.at ?? "");
    return byTime !== 0 ? byTime : (a.taskNumber ?? 0) - (b.taskNumber ?? 0);
  });
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function dateOr(value: unknown, fallback: Date): Date {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export const RESOURCE_OF = {
  branch_push: "branch",
  pr_opened: "pull_request",
  pr_merged: "pull_request",
  issue_opened: "issue",
  issue_closed: "issue",
} as const;

export type LinkRow = {
  taskId: string;
  metadata: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The integration events recorded on the project's links. A link keeps
 * its creation time and its last update, so each event is dated by the
 * one that marks it (a merge by `mergedAt` when known).
 */
export function eventsFromLinks(
  eventType: RuleEventType,
  links: readonly LinkRow[],
): IntegrationEvent[] {
  return links.flatMap((link): IntegrationEvent[] => {
    const meta = parseMetadata(link.metadata);
    const at = (() => {
      switch (eventType) {
        case "branch_push":
          return link.updatedAt;
        case "pr_opened":
          return link.createdAt;
        case "pr_merged":
          return meta.merged === true
            ? dateOr(meta.mergedAt, link.updatedAt)
            : null;
        case "issue_opened":
          // Issues linked from Margaya were not opened on the forge first.
          return meta.createdFrom === "margaya" ? null : link.createdAt;
        case "issue_closed":
          return meta.state === "closed" && meta.createdFrom !== "margaya"
            ? link.updatedAt
            : null;
      }
    })();
    return at ? [{ taskId: link.taskId, at, eventType }] : [];
  });
}
