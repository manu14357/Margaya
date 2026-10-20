import { useMutation } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { checkDuplicatesWithAi } from "@/fetchers/ai/build";
import { useAiAvailability } from "@/hooks/queries/ai/use-ai";
import { aiErrorKey } from "@/lib/ai/format";
import { cn } from "@/lib/cn";

export type SimilarTask = { id: string; key: string; title: string };

type SimilarTaskHintsProps = {
  tasks: readonly SimilarTask[];
  /** The task page each hint opens, in a new tab so the form stays. */
  taskHref: (taskId: string) => string;
  onDismiss: () => void;
  /** With AI available here, "Check with AI" re-ranks the hints. */
  ai?: { projectId: string; title: string; description: string };
  /** Offers "Duplicate of this" on each hint; the link is made on create. */
  onMarkDuplicate?: (task: SimilarTask) => void;
  markedId?: string | null;
};

/**
 * A quiet list of open tasks like the title being typed, under the title.
 * Informational only: it never blocks creating, and it can be dismissed.
 * The list itself is full-text search and needs no AI; with AI on, an
 * optional check keeps likely duplicates with a short reason.
 */
export default function SimilarTaskHints({
  tasks,
  taskHref,
  onDismiss,
  ai,
  onMarkDuplicate,
  markedId,
}: SimilarTaskHintsProps) {
  const { t } = useTranslation();
  const { available } = useAiAvailability(ai?.projectId ?? null);
  const check = useMutation({ mutationFn: checkDuplicatesWithAi });
  const draftTitle = (ai?.title ?? "").trim().slice(0, 255);

  if (tasks.length === 0) return null;

  // An answer for an earlier title is stale.
  const checked =
    check.variables?.title === draftTitle ? check.data?.tasks : undefined;
  const rows: (SimilarTask & {
    verdict?: "duplicate" | "related";
    reason?: string;
  })[] = checked ?? [...tasks];

  return (
    <section
      aria-label={t("tasks:create.similarTitle")}
      aria-live="polite"
      className="rounded-md border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {checked
            ? t("ai:duplicates.checkedTitle")
            : t("tasks:create.similarTitle")}
        </p>
        <div className="flex items-center gap-1">
          {ai && available && draftTitle && !checked && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={check.isPending}
              onClick={() =>
                check.mutate({
                  projectId: ai.projectId,
                  title: draftTitle,
                  ...(ai.description.trim()
                    ? { description: ai.description.slice(0, 4000) }
                    : {}),
                })
              }
            >
              <Sparkles aria-hidden className="size-3.5" />
              {check.isPending
                ? t("ai:duplicates.checking")
                : t("ai:duplicates.check")}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("tasks:create.similarDismiss")}
            onClick={onDismiss}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {check.isError && check.variables?.title === draftTitle && (
        <p className="mt-1 text-muted-foreground text-xs">
          {t(aiErrorKey(check.error))}
        </p>
      )}
      {checked && checked.length === 0 && (
        <p className="mt-1 text-muted-foreground text-xs">
          {t("ai:duplicates.none")}
        </p>
      )}
      <ul className="mt-1 space-y-1">
        {rows.map((task) => (
          <li key={task.id} className="min-w-0 text-xs">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {task.key}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {task.title}
              </span>
              {task.verdict && (
                <span
                  className={cn(
                    "shrink-0",
                    task.verdict === "duplicate"
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {t(`ai:duplicates.verdict.${task.verdict}`)}
                </span>
              )}
              {onMarkDuplicate &&
                (markedId === task.id ? (
                  <span className="shrink-0 text-muted-foreground">
                    {t("ai:duplicates.marked")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("ai:duplicates.markLabel", {
                      key: task.key,
                    })}
                    onClick={() => onMarkDuplicate(task)}
                  >
                    {t("ai:duplicates.mark")}
                  </button>
                ))}
              <a
                href={taskHref(task.id)}
                target="_blank"
                rel="noopener"
                className="shrink-0 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("tasks:create.similarOpenLabel", {
                  key: task.key,
                  title: task.title,
                })}
              >
                {t("tasks:create.similarOpen")}
              </a>
            </div>
            {task.reason && (
              <p className="mt-0.5 ps-1 text-muted-foreground">{task.reason}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
