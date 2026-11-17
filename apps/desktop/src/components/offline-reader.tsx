import { useEffect, useRef } from "react";
import { useT } from "../lib/i18n";
import type { OfflineItem, OfflineItemSummary } from "../lib/ipc";
import { parseOfflineText } from "../lib/offline-text";

function locale(): string | undefined {
  return document.documentElement.lang || undefined;
}

function formatTime(millis: number): string {
  try {
    return new Intl.DateTimeFormat(locale(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(millis));
  } catch {
    return new Date(millis).toISOString();
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale(), { dateStyle: "medium" }).format(
      date,
    );
  } catch {
    return value;
  }
}

/** "Recently opened" on the offline page: this server's saved copies. */
export function RecentList({
  items,
  onOpen,
}: {
  items: OfflineItemSummary[];
  onOpen: (item: OfflineItemSummary) => void;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <section
      className="offline-recent"
      aria-labelledby="offline-recent-heading"
    >
      <h2 id="offline-recent-heading">{t("offline.recentHeading")}</h2>
      <p className="muted">{t("offline.recentHint")}</p>
      <ul>
        {items.map((item) => {
          const context = [item.workspaceName, item.projectName]
            .filter(Boolean)
            .join(" / ");
          return (
            <li key={`${item.kind}:${item.id}`}>
              <button
                type="button"
                className="offline-recent-item"
                onClick={() => onOpen(item)}
              >
                <span className="offline-recent-title">
                  {item.title || t("offline.untitled")}
                </span>
                <span className="offline-recent-meta">
                  {item.kind === "task"
                    ? t("offline.kindTask")
                    : t("offline.kindPage")}
                  {context ? ` · ${context}` : ""}
                  {` · ${t("offline.savedAt", { time: formatTime(item.savedAt) })}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The saved text, rendered as React text only (never HTML). */
export function OfflineText({ text }: { text: string }) {
  const blocks = parseOfflineText(text);
  return (
    <div className="offline-text">
      {blocks.map((block, index) => {
        // The blocks never reorder, so their position is a stable key.
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          const Heading =
            block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
          return <Heading key={key}>{block.text}</Heading>;
        }
        if (block.type === "item") {
          return (
            <p key={key} className="offline-text-item">
              <span aria-hidden="true" className="offline-text-marker">
                {block.checked === null
                  ? block.marker
                  : block.checked
                    ? "☑"
                    : "☐"}
              </span>
              <span>{block.text}</span>
            </p>
          );
        }
        return (
          <p key={key} className="offline-text-paragraph">
            {block.lines.join("\n")}
          </p>
        );
      })}
    </div>
  );
}

/**
 * One saved copy, read-only, under a banner that says it is a saved copy.
 * Try again stays at hand; Back returns to the list.
 */
export function OfflineReader({
  item,
  retrying,
  onRetry,
  onBack,
}: {
  item: OfflineItem;
  retrying: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const context = [item.workspaceName, item.projectName]
    .filter(Boolean)
    .join(" / ");
  const meta: Array<[string, string]> = [];
  if (item.status) meta.push([t("offline.status"), item.status]);
  if (item.priority) meta.push([t("offline.priority"), item.priority]);
  if (item.dueDate) meta.push([t("offline.due"), formatDate(item.dueDate)]);
  if (item.assignees.length > 0)
    meta.push([t("offline.assignees"), item.assignees.join(", ")]);

  return (
    <article className="offline-reader">
      <div className="offline-banner" role="note">
        <p>{t("offline.savedCopy", { time: formatTime(item.savedAt) })}</p>
        <div className="row">
          <button
            type="button"
            className="button primary"
            disabled={retrying}
            onClick={onRetry}
          >
            {retrying ? t("offline.retrying") : t("offline.retry")}
          </button>
          <button type="button" className="button" onClick={onBack}>
            {t("offline.back")}
          </button>
        </div>
      </div>
      <p className="offline-reader-context muted">
        {item.kind === "task" ? t("offline.kindTask") : t("offline.kindPage")}
        {context ? ` · ${context}` : ""}
      </p>
      <h1 ref={heading} tabIndex={-1}>
        {item.title || t("offline.untitled")}
      </h1>
      {meta.length > 0 ? (
        <dl className="offline-meta">
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.bodyText.trim() ? (
        <OfflineText text={item.bodyText} />
      ) : (
        <p className="muted">{t("offline.noText")}</p>
      )}
    </article>
  );
}
