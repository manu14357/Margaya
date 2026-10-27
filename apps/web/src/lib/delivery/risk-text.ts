import { formatTaskKey } from "@/lib/task-key";
import type { RiskSignal, RiskTaskRef } from "@/types/delivery";

// One sentence per risk signal: the static i18n key and its options. Pure,
// so the radar, the Home widget and their tests share it.

export type SignalText = {
  key: string;
  options: Record<string, string | number>;
};

type Context = {
  tasks: ReadonlyMap<string, RiskTaskRef>;
  /** Display name of a user id, or null when unknown. */
  personName: (userId: string) => string | null;
  formatDay: (day: string) => string;
  hiddenTaskLabel: string;
  someoneLabel: string;
  /** The critical path's finish day, for its signal. */
  criticalFinish?: string | null;
};

export function taskLabel(task: RiskTaskRef): string {
  return formatTaskKey(task.projectSlug, task.number);
}

export function signalText(signal: RiskSignal, context: Context): SignalText {
  const count = signal.total;
  switch (signal.kind) {
    case "critical_path": {
      const finish = signal.finishDate ?? context.criticalFinish ?? null;
      return {
        key:
          signal.severity === "high"
            ? "delivery:risks.kinds.critical_path_late"
            : "delivery:risks.kinds.critical_path_tight",
        options: {
          date: finish ? context.formatDay(finish) : "",
          deadline: signal.deadline ? context.formatDay(signal.deadline) : "",
        },
      };
    }
    case "blocked_chain": {
      const head = signal.headTaskId
        ? context.tasks.get(signal.headTaskId)
        : undefined;
      return {
        key: "delivery:risks.kinds.blocked_chain",
        options: {
          count,
          head: head ? taskLabel(head) : context.hiddenTaskLabel,
        },
      };
    }
    case "ageing":
      return {
        key: "delivery:risks.kinds.ageing",
        options: {
          count,
          days: Math.max(1, Math.round(signal.thresholdDays ?? 0)),
        },
      };
    case "overdue_cluster":
      return signal.assigneeId
        ? {
            key: "delivery:risks.kinds.overdue_cluster",
            options: {
              count,
              name:
                context.personName(signal.assigneeId) ?? context.someoneLabel,
            },
          }
        : {
            key: "delivery:risks.kinds.overdue_cluster_unassigned",
            options: { count },
          };
    case "overdue":
      return { key: "delivery:risks.kinds.overdue", options: { count } };
    case "unassigned_near_deadline":
      return {
        key: "delivery:risks.kinds.unassigned_near_deadline",
        options: {
          count,
          date: signal.deadline ? context.formatDay(signal.deadline) : "",
        },
      };
    case "dependency_loop":
      return {
        key: "delivery:risks.kinds.dependency_loop",
        options: { count },
      };
  }
}
