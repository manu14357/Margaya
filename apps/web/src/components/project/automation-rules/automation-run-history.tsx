import {
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleSlash,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import type { AutomationRun } from "@/fetchers/automation-rule/automation-rules";
import { useAutomationRuns } from "@/hooks/queries/automation-rule/use-automation-rules";
import { formatRelativeTime } from "@/lib/format";

// The latest runs: rule, task, outcome and each action's result. The
// outcome is an icon plus a word, never colour alone.

const K = "settings:automationRules";

const OUTCOME_ICON = {
  success: CircleCheck,
  partial: CircleAlert,
  failed: CircleAlert,
  skipped: CircleSlash,
} as const;

const OUTCOME_TONE = {
  success: "text-muted-foreground",
  partial: "text-warning-foreground",
  failed: "text-destructive-foreground",
  skipped: "text-muted-foreground",
} as const;

const KNOWN_ERRORS = new Set([
  "LOOP_DEPTH",
  "RATE_LIMITED",
  // Run agent: the agent is off or gone, the rule has no owner, AI is off.
  "AGENT_UNAVAILABLE",
  "NO_RULE_OWNER",
  "AI_DISABLED",
]);

function RunRow({ run }: { run: AutomationRun }) {
  const { t, i18n } = useTranslation();
  const Icon = OUTCOME_ICON[run.outcome] ?? CircleMinus;
  const failed = run.actions.filter((action) => action.status === "failed");
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
      <span
        className={`inline-flex shrink-0 items-center gap-1 ${OUTCOME_TONE[run.outcome]}`}
      >
        <Icon className="size-3.5" aria-hidden />
        {t(`${K}.outcomes.${run.outcome}`)}
      </span>
      <span className="min-w-0 truncate font-medium">{run.ruleName}</span>
      {run.taskKey && (
        <span className="shrink-0 font-mono text-muted-foreground">
          {run.taskKey}
        </span>
      )}
      {run.taskTitle && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {run.taskTitle}
        </span>
      )}
      <span className="ms-auto shrink-0 text-muted-foreground tabular-nums">
        {formatRelativeTime(run.createdAt, i18n?.resolvedLanguage)}
      </span>
      {run.error && KNOWN_ERRORS.has(run.error) && (
        <span className="w-full text-muted-foreground">
          {t(`${K}.errors.${run.error}`)}
        </span>
      )}
      {failed.length > 0 && (
        <span className="w-full text-muted-foreground">
          {t(`${K}.history.failedActions`, {
            actions: failed
              .map((action) => t(`${K}.actions.${action.type}`))
              .join(", "),
          })}
        </span>
      )}
    </li>
  );
}

export default function AutomationRunHistory({
  projectId,
}: {
  projectId: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAutomationRuns(projectId);

  if (isLoading) {
    return <Spinner className="size-4" />;
  }
  if (isError) {
    return (
      <p className="text-destructive-foreground text-xs">
        {t(`${K}.history.error`)}
      </p>
    );
  }
  const runs = data?.runs ?? [];
  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">{t(`${K}.history.empty`)}</p>
    );
  }
  return (
    <ul
      className="divide-y rounded-md border border-border bg-card"
      aria-label={t(`${K}.history.title`)}
    >
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </ul>
  );
}
