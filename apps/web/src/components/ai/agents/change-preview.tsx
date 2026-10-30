import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import AiMarkdown from "@/components/ai/ai-markdown";
import { changeDiff } from "@/lib/ai/agents";
import { getPriorityLabel, getStatusLabel } from "@/lib/i18n/domain";

type ChangeLinks = { taskUrl: string | null; createdUrl: string | null };

// Long Markdown values: comments, descriptions.
const MARKDOWN_FIELDS = new Set([
  "ai:agents.change.fields.description",
  "ai:agents.change.fields.comment",
  "ai:agents.change.fields.pageContent",
  "ai:agents.change.fields.pageSection",
]);

const OPEN_KEYS: Record<string, string> = {
  create_page: "ai:agents.change.openPage",
  update_page: "ai:agents.change.openPage",
  create_subtask: "ai:agents.change.openSubtask",
  link_tasks: "ai:agents.change.openLinked",
};

/** An in-app link: plain clicks navigate in place, modified ones open a tab. */
function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    void navigate({ href });
  };
  return (
    <a href={href} onClick={open} className={className}>
      {children}
    </a>
  );
}

/** A change-set entry as before → after lines, for review. */
export function ChangePreview({
  change,
  links,
}: {
  change: Record<string, unknown> | null;
  /** Where the touched task and the created item live, once applied. */
  links?: ChangeLinks | null;
}) {
  const { t } = useTranslation();
  const openKey = OPEN_KEYS[String(change?.op ?? "")];
  const { taskLabel, lines } = changeDiff(change, {
    priority: getPriorityLabel,
    status: getStatusLabel,
  });
  if (lines.length === 0) return null;
  const empty = t("ai:agents.change.empty");
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {(taskLabel || (openKey && links?.createdUrl)) && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {taskLabel &&
            (links?.taskUrl ? (
              <AppLink
                href={links.taskUrl}
                className="truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {taskLabel}
              </AppLink>
            ) : (
              <span className="truncate text-muted-foreground">
                {taskLabel}
              </span>
            ))}
          {openKey && links?.createdUrl && (
            <AppLink
              href={links.createdUrl}
              className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
            >
              {t(openKey)}
              <ArrowUpRight className="size-3" aria-hidden />
            </AppLink>
          )}
        </p>
      )}
      <dl className="flex flex-col gap-1.5">
        {lines.map((line, index) => (
          <div
            // Lines have no ids; their order is stable per change.
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            key={index}
            className="grid gap-1 sm:grid-cols-[8rem_1fr]"
          >
            <dt className="text-muted-foreground">
              {t(line.labelKey, line.labelValues)}
            </dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
              {line.before !== null && (
                <>
                  <span className="sr-only">
                    {t("ai:agents.change.before")}
                  </span>
                  <span className="max-w-full break-words text-muted-foreground line-through decoration-muted-foreground/60">
                    {line.before || empty}
                  </span>
                  {line.after !== null && (
                    <ArrowRight
                      className="size-3 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                </>
              )}
              {line.after !== null && (
                <>
                  <span className="sr-only">{t("ai:agents.change.after")}</span>
                  {MARKDOWN_FIELDS.has(line.labelKey) && line.after ? (
                    <AiMarkdown
                      text={
                        line.after.length > 1500
                          ? `${line.after.slice(0, 1500)}…`
                          : line.after
                      }
                      className="max-h-64 w-full overflow-y-auto rounded-md border border-border/70 bg-muted/30 px-2.5 py-1.5 text-xs"
                    />
                  ) : (
                    <span className="max-w-full whitespace-pre-wrap break-words text-foreground">
                      {line.after.length > 600
                        ? `${line.after.slice(0, 600)}…`
                        : line.after || empty}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
