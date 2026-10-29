import type { AgentRunStatus } from "@/fetchers/ai/agents";

// Static i18n keys and helpers for the agent screens (Agents settings, the
// Agent Desk, approval cards and "by Agent X on behalf of Y").

export const RUN_STATUS_KEYS: Record<AgentRunStatus, string> = {
  queued: "ai:agents.status.queued",
  running: "ai:agents.status.running",
  awaiting_approval: "ai:agents.status.awaiting_approval",
  needs_input: "ai:agents.status.needs_input",
  succeeded: "ai:agents.status.succeeded",
  failed: "ai:agents.status.failed",
  cancelled: "ai:agents.status.cancelled",
};

export const RUN_STATUSES = Object.keys(RUN_STATUS_KEYS) as AgentRunStatus[];

export const STEP_STATUS_KEYS: Record<string, string> = {
  ok: "ai:agents.stepStatus.ok",
  error: "ai:agents.stepStatus.error",
  denied: "ai:agents.stepStatus.denied",
  pending: "ai:agents.stepStatus.pending",
  applied: "ai:agents.stepStatus.applied",
  rejected: "ai:agents.stepStatus.rejected",
  expired: "ai:agents.stepStatus.expired",
  reverted: "ai:agents.stepStatus.reverted",
};

export const TOOL_KEYS: Record<string, string> = {
  read_task: "ai:agents.tools.read_task",
  read_project: "ai:agents.tools.read_project",
  read_page: "ai:agents.tools.read_page",
  search_workspace: "ai:agents.tools.search_workspace",
  add_comment: "ai:agents.tools.add_comment",
  update_task: "ai:agents.tools.update_task",
  move_status: "ai:agents.tools.move_status",
  create_subtask: "ai:agents.tools.create_subtask",
  create_page: "ai:agents.tools.create_page",
  link_tasks: "ai:agents.tools.link_tasks",
  delete_task: "ai:agents.tools.delete_task",
  bulk_move_status: "ai:agents.tools.bulk_move_status",
  ask_person: "ai:agents.tools.ask_person",
  web_search: "ai:agents.tools.web_search",
};

export const TRIGGER_KEYS: Record<string, string> = {
  mention: "ai:agents.desk.trigger.mention",
  assign: "ai:agents.desk.trigger.assign",
  manual: "ai:agents.desk.trigger.manual",
  schedule: "ai:agents.desk.trigger.schedule",
  automation: "ai:agents.desk.trigger.automation",
  chat: "ai:agents.desk.trigger.chat",
  intake: "ai:agents.desk.trigger.intake",
};

// Run stop codes that are not AI gateway errors (those use ai:errors.*).
const RUN_ERROR_KEYS: Record<string, string> = {
  AGENT_GONE: "ai:agents.runErrors.AGENT_GONE",
  AGENT_DISABLED: "ai:agents.runErrors.AGENT_DISABLED",
  AGENT_LEFT: "ai:agents.runErrors.AGENT_LEFT",
  PRINCIPAL_LEFT: "ai:agents.runErrors.PRINCIPAL_LEFT",
  AI_USE_DENIED: "ai:agents.runErrors.AI_USE_DENIED",
  NOT_IN_SCOPE: "ai:agents.runErrors.NOT_IN_SCOPE",
  TIME_LIMIT: "ai:agents.runErrors.TIME_LIMIT",
  OUTPUT_LIMIT: "ai:agents.runErrors.OUTPUT_LIMIT",
  TURN_LIMIT: "ai:agents.runErrors.TURN_LIMIT",
  INTERRUPTED: "ai:agents.runErrors.INTERRUPTED",
  APPROVAL_EXPIRED: "ai:agents.runErrors.APPROVAL_EXPIRED",
  NEEDS_INPUT_EXPIRED: "ai:agents.runErrors.NEEDS_INPUT_EXPIRED",
  OUTSIDE_AGENT_PROJECTS: "ai:agents.runErrors.OUTSIDE_AGENT_PROJECTS",
  INTERNAL: "ai:agents.runErrors.INTERNAL",
};

const GATEWAY_CODES = new Set([
  "AI_DISABLED",
  "AI_NOT_CONFIGURED",
  "AI_ROUTE_BLOCKED",
  "AI_BUDGET_EXCEEDED",
  "AI_RATE_LIMITED",
  "AI_REFUSED",
  "AI_PROVIDER_ERROR",
]);

export function runErrorKey(code: string | null): string | null {
  if (!code) return null;
  if (GATEWAY_CODES.has(code)) return `ai:errors.${code}`;
  return RUN_ERROR_KEYS[code] ?? "ai:agents.runErrors.INTERNAL";
}

/** The "via" attribution an agent's activity row carries. */
export type AgentVia = {
  agentId: string;
  agentUserId: string;
  agentName: string;
  onBehalfOf: string;
  onBehalfOfName: string | null;
  runId: string;
};

export function agentViaOf(eventData: unknown): AgentVia | null {
  if (!eventData || typeof eventData !== "object") return null;
  const via = (eventData as { via?: unknown }).via;
  if (!via || typeof via !== "object") return null;
  const record = via as Record<string, unknown>;
  return typeof record.agentName === "string" &&
    typeof record.runId === "string"
    ? (record as unknown as AgentVia)
    : null;
}

export type DiffLine = {
  /** i18n key of the field label. */
  labelKey: string;
  labelValues?: Record<string, unknown>;
  before: string | null;
  after: string | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/**
 * Before/after lines of a change-set entry for review. Unknown operations
 * show nothing rather than guessing.
 */
export function changeDiff(
  change: Record<string, unknown> | null,
  labels: {
    priority: (value: string) => string;
    status: (value: string) => string;
  },
): { taskLabel: string | null; lines: DiffLine[] } {
  if (!change) return { taskLabel: null, lines: [] };
  const taskLabel = text(change.taskLabel);
  const before = (change.before ?? {}) as Record<string, unknown>;
  const after = (change.after ?? {}) as Record<string, unknown>;
  switch (change.op) {
    case "comment":
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.comment",
            before: null,
            after: text(change.content),
          },
        ],
      };
    case "update_task":
      return {
        taskLabel,
        lines: Object.keys(after).map((field) => ({
          labelKey: `ai:agents.change.fields.${field}`,
          before:
            field === "priority"
              ? labels.priority(String(before[field] ?? ""))
              : text(before[field]),
          after:
            field === "priority"
              ? labels.priority(String(after[field] ?? ""))
              : text(after[field]),
        })),
      };
    case "set_status":
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.status",
            before: labels.status(String(before.status ?? "")),
            after: labels.status(String(after.status ?? "")),
          },
        ],
      };
    case "create_subtask":
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.subtask",
            before: null,
            after: text(change.title),
          },
        ],
      };
    case "create_page":
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.page",
            before: null,
            after: text(change.title),
          },
        ],
      };
    case "link_tasks":
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.relation",
            labelValues: { relation: String(change.relationType ?? "") },
            before: null,
            after: text(change.targetLabel),
          },
        ],
      };
    case "delete_task":
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.delete",
            before: taskLabel,
            after: null,
          },
        ],
      };
    case "connector_call": {
      let args = "";
      try {
        args = JSON.stringify(change.args ?? {});
      } catch {
        args = "";
      }
      return {
        taskLabel,
        lines: [
          {
            labelKey: "ai:agents.change.fields.connectorCall",
            labelValues: { connector: String(change.connectorName ?? "") },
            before: null,
            after: `${String(change.tool ?? "")}${args && args !== "{}" ? ` ${args.length > 400 ? `${args.slice(0, 400)}…` : args}` : ""}`,
          },
        ],
      };
    }
    case "bulk_set_status": {
      const items = Array.isArray(change.items)
        ? (change.items as Record<string, unknown>[])
        : [];
      return {
        taskLabel: null,
        lines: items.map((item) => ({
          labelKey: "ai:agents.change.fields.statusOf",
          labelValues: { task: String(item.taskLabel ?? "") },
          before: labels.status(String(item.before ?? "")),
          after: labels.status(String(item.after ?? "")),
        })),
      };
    }
    default:
      return { taskLabel, lines: [] };
  }
}

export function toolLabel(t: Translate, name: string | null): string {
  if (!name) return t("ai:agents.step.model");
  const key = TOOL_KEYS[name];
  if (key) return t(key);
  // connector_<service>__<tool>: a tool of an outside MCP server.
  const outside = /^connector_[a-z0-9_]+?__(.+)$/.exec(name);
  if (outside?.[1]) {
    return t("ai:agents.tools.connector", { tool: outside[1] });
  }
  return name;
}

/** How long a run worked: seconds, or minutes from a minute on. */
export function workedFor(
  startedAt: string | Date | null,
  finishedAt: string | Date | null,
): { key: string; values: { count: number } } | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60
    ? { key: "ai:agents.desk.workedSeconds", values: { count: seconds } }
    : {
        key: "ai:agents.desk.workedMinutes",
        values: { count: Math.round(seconds / 60) },
      };
}

/** Runs that ended and can be followed up (chat with the agent). */
export function canFollowUp(status: string): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}
