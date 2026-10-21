import { Bot, Check, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CodingHandoff } from "@/fetchers/coding-agent/coding-agent";
import { useTaskCodingAgents } from "@/hooks/queries/coding-agent/use-coding-agent";
import { cn } from "@/lib/cn";

type StepKey =
  | "issue_created"
  | "working"
  | "ready_for_review"
  | "merged"
  | "closed";

type Step = { key: StepKey; at: string | null; done: boolean };

const STEP_KEYS = {
  issue_created: "ai:codingAgent.steps.issue_created",
  working: "ai:codingAgent.steps.working",
  ready_for_review: "ai:codingAgent.steps.ready_for_review",
  merged: "ai:codingAgent.steps.merged",
  closed: "ai:codingAgent.steps.closed",
} as const satisfies Record<StepKey, string>;

/**
 * The four steps of a handoff, from its timestamps. The last one is
 * "merged" or, for a pull request closed without merging, "closed".
 */
export function handoffSteps(handoff: CodingHandoff): Step[] {
  const finishedKey: StepKey = handoff.state === "closed" ? "closed" : "merged";
  return [
    { key: "issue_created", at: handoff.createdAt, done: true },
    {
      key: "working",
      at: handoff.workingAt,
      done: Boolean(handoff.workingAt),
    },
    {
      key: "ready_for_review",
      at: handoff.readyAt,
      done: Boolean(handoff.readyAt),
    },
    {
      key: finishedKey,
      at: handoff.finishedAt,
      done: Boolean(handoff.finishedAt),
    },
  ];
}

function formatWhen(value: string | null, language: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function HandoffRow({ handoff }: { handoff: CodingHandoff }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en-US";
  const steps = handoffSteps(handoff);
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-foreground">
          {handoff.sentBy?.name
            ? t("ai:codingAgent.sentBy", {
                profile: handoff.profileName,
                name: handoff.sentBy.name,
              })
            : t("ai:codingAgent.sentByUnknown", {
                profile: handoff.profileName,
              })}
        </span>
        <a
          href={handoff.issueUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-2 hover:underline"
        >
          {t("ai:codingAgent.issueLink", { number: handoff.issueNumber })}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
        {handoff.prUrl && handoff.prNumber !== null && (
          <a
            href={handoff.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-2 hover:underline"
          >
            {t("ai:codingAgent.prLink", { number: handoff.prNumber })}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        )}
      </div>
      <ol
        aria-label={t("ai:codingAgent.timelineLabel")}
        className="flex flex-wrap items-center gap-x-1 gap-y-1"
      >
        {steps.map((step, index) => {
          const when = formatWhen(step.at, language);
          return (
            <li key={step.key} className="flex items-center gap-1">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px w-4",
                    step.done ? "bg-foreground/40" : "bg-border",
                  )}
                />
              )}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  step.done
                    ? "border-border bg-muted text-foreground"
                    : "border-dashed border-border text-muted-foreground",
                )}
                title={when || undefined}
              >
                {step.done && <Check aria-hidden="true" className="size-3" />}
                {t(STEP_KEYS[step.key])}
                <span className="sr-only">
                  {step.done ? when : t("ai:codingAgent.pending")}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </li>
  );
}

/** Compact timelines of the task's coding-agent handoffs (newest first). */
export function CodingHandoffTimeline({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { data } = useTaskCodingAgents(taskId);
  const handoffs = data?.handoffs ?? [];
  if (handoffs.length === 0) return null;
  return (
    <section
      aria-label={t("ai:codingAgent.timelineTitle")}
      className="space-y-2 rounded-lg border border-border px-4 py-3"
    >
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
        {t("ai:codingAgent.timelineTitle")}
      </h3>
      <ul className="space-y-3">
        {handoffs.slice(0, 3).map((handoff) => (
          <HandoffRow key={handoff.id} handoff={handoff} />
        ))}
      </ul>
    </section>
  );
}
