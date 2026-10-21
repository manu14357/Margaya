import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RuleDryRun } from "@/fetchers/ai/rules";
import { formatDateShort } from "@/lib/format";

// The dry run's answer: how many tasks the rule would have changed, the
// caveats, and the first matches (computed from history; no AI involved).

const SHOWN = 20;

type Note = RuleDryRun["notes"][number];

const NOTE_KEYS: Record<Note, `ai:rules.notes.${Note}`> = {
  integration_not_connected: "ai:rules.notes.integration_not_connected",
  branch_push_last_only: "ai:rules.notes.branch_push_last_only",
  threshold_from_last_update: "ai:rules.notes.threshold_from_last_update",
  flow_alerts_notify_only: "ai:rules.notes.flow_alerts_notify_only",
  nothing_enabled: "ai:rules.notes.nothing_enabled",
  conditions_current_state: "ai:rules.notes.conditions_current_state",
};

export default function RuleDryRunResults({ result }: { result: RuleDryRun }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language;
  const shown = result.matches.slice(0, SHOWN);
  const more = result.total - shown.length;

  return (
    <div className="space-y-2 text-xs">
      <p className="font-medium text-sm">
        {result.changed > 0
          ? t("ai:rules.dryRunSummary", {
              changed: result.changed,
              days: result.days,
            })
          : t("ai:rules.dryRunNone", { days: result.days })}
      </p>
      {result.notes.map((note) => (
        <p key={note} className="text-muted-foreground">
          {t(NOTE_KEYS[note])}
        </p>
      ))}
      {shown.length > 0 && (
        <ul className="divide-y rounded-md border border-border bg-card">
          {shown.map((match) => (
            <li
              key={`${match.taskId}-${match.at ?? ""}-${match.kind}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
            >
              {match.taskNumber !== null && (
                <span className="shrink-0 font-mono text-muted-foreground">
                  {`${result.projectSlug.toUpperCase()}-${match.taskNumber}`}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-foreground">
                {match.title}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                {match.from && <span>{match.from}</span>}
                <ArrowRight aria-hidden className="size-3" />
                <span>
                  {match.kind === "archive"
                    ? t("ai:rules.archived")
                    : (match.to ?? "—")}
                </span>
              </span>
              {match.outcome !== "change" && (
                <span className="shrink-0 text-muted-foreground italic">
                  {t(
                    match.outcome === "unchanged"
                      ? "ai:rules.outcomes.unchanged"
                      : "ai:rules.outcomes.skipped",
                  )}
                </span>
              )}
              {match.at && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatDateShort(match.at, locale)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <p className="text-muted-foreground">{t("ai:rules.more", { more })}</p>
      )}
    </div>
  );
}
