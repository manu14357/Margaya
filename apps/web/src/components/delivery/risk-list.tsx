import { Link } from "@tanstack/react-router";
import {
  CalendarX,
  Clock,
  GitFork,
  Link2Off,
  Repeat,
  Route,
  UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  resolvePeople,
  useWorkspacePeople,
} from "@/components/module/module-people";
import { cn } from "@/lib/cn";
import { formatCycleDate } from "@/lib/cycle/dates";
import { signalText, taskLabel } from "@/lib/delivery/risk-text";
import type { RiskSignal, RiskTaskRef } from "@/types/delivery";

// The rows of a risk list: an icon, a severity dot (with its name for
// screen readers), one sentence, and links to the tasks. Shared by the
// radar (cycle, module, project) and the Home widget.

const KIND_ICON: Record<RiskSignal["kind"], typeof Clock> = {
  critical_path: Route,
  blocked_chain: Link2Off,
  ageing: Clock,
  overdue_cluster: CalendarX,
  overdue: CalendarX,
  unassigned_near_deadline: UserX,
  dependency_loop: Repeat,
};

const SEVERITY_DOT: Record<RiskSignal["severity"], string> = {
  high: "bg-destructive",
  medium: "bg-warning",
  low: "bg-muted-foreground/50",
};

const TASK_LINKS = 3;

export function RiskRow({
  signal,
  workspaceId,
  tasks,
  criticalFinish,
  context,
}: {
  signal: RiskSignal;
  workspaceId: string;
  tasks: ReadonlyMap<string, RiskTaskRef>;
  criticalFinish?: string | null;
  /** A line above the sentence (Home: project and cycle). */
  context?: string;
}) {
  const { t } = useTranslation();
  const people = useWorkspacePeople(workspaceId);
  const text = signalText(signal, {
    tasks,
    personName: (userId) => resolvePeople([userId], people)[0]?.name || null,
    formatDay: formatCycleDate,
    hiddenTaskLabel: t("delivery:risks.hiddenTask"),
    someoneLabel: t("delivery:risks.someone"),
    criticalFinish,
  });
  const Icon = KIND_ICON[signal.kind] ?? GitFork;
  const linked = signal.taskIds
    .map((id) => tasks.get(id))
    .filter((task): task is RiskTaskRef => Boolean(task));
  const shown = linked.slice(0, TASK_LINKS);
  const more = signal.total - shown.length;

  return (
    <li className="flex gap-2 py-1.5">
      <Icon
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        {context && (
          <p className="truncate text-muted-foreground text-xs">{context}</p>
        )}
        <p className="flex items-start gap-1.5 text-sm leading-snug">
          <span
            className={cn(
              "mt-1.5 size-1.5 shrink-0 rounded-full",
              SEVERITY_DOT[signal.severity],
            )}
            aria-hidden
          />
          <span className="sr-only">
            {t(`delivery:risks.severity.${signal.severity}`)}:
          </span>
          <span>{t(text.key, text.options)}</span>
        </p>
        {shown.length > 0 && (
          <p className="flex flex-wrap gap-x-2 gap-y-0.5 pl-3 text-xs">
            {shown.map((task) => (
              <Link
                key={task.id}
                to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                params={{
                  workspaceId,
                  projectId: task.projectId,
                  taskId: task.id,
                }}
                title={task.title}
                className="max-w-48 truncate text-muted-foreground hover:text-foreground hover:underline"
              >
                <span className="font-medium tabular-nums">
                  {taskLabel(task)}
                </span>{" "}
                {task.title}
              </Link>
            ))}
            {more > 0 && <span className="text-muted-foreground">+{more}</span>}
          </p>
        )}
      </div>
    </li>
  );
}

export function useTaskMap(tasks: readonly RiskTaskRef[] | undefined) {
  return useMemo(
    () => new Map((tasks ?? []).map((task) => [task.id, task])),
    [tasks],
  );
}

/** At most `limit` rows, with a "Show all" toggle for the rest. */
export function useCollapsible<T>(items: readonly T[], limit: number) {
  const [expanded, setExpanded] = useState(false);
  return {
    visible: expanded ? items : items.slice(0, limit),
    hidden: Math.max(0, items.length - limit),
    expanded,
    toggle: () => setExpanded((value) => !value),
  };
}
