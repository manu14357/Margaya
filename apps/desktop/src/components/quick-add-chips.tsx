import { useT } from "../lib/i18n";
import type { DetectedToken, Priority } from "../lib/quick-add-parse";

function formatDay(date: Date) {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/** What quick add read from the title; removing a chip keeps the words. */
export function QuickAddChips({
  tokens,
  onRemove,
}: {
  tokens: DetectedToken[];
  onRemove: (key: string) => void;
}) {
  const t = useT();
  if (tokens.length === 0) return null;

  const priorityName = (priority: Priority) => {
    switch (priority) {
      case "urgent":
        return t("quickAdd.priorities.urgent");
      case "high":
        return t("quickAdd.priorities.high");
      case "medium":
        return t("quickAdd.priorities.medium");
      case "low":
        return t("quickAdd.priorities.low");
    }
  };

  const label = (token: DetectedToken) => {
    switch (token.kind) {
      case "due":
        return t("quickAdd.dueChip", { date: formatDay(token.date) });
      case "priority":
        return t("quickAdd.priorityChip", {
          priority: priorityName(token.priority),
        });
      case "assignee":
        return t("quickAdd.assigneeChip", { name: token.member.name });
      case "unknownAssignee":
        return t("quickAdd.unknownAssignee", { name: token.name });
    }
  };

  return (
    <ul className="chips" aria-label={t("quickAdd.detected")}>
      {tokens.map((token) => {
        const text = label(token);
        return (
          <li
            key={token.key}
            className={
              token.kind === "unknownAssignee" ? "chip warning" : "chip"
            }
          >
            <span>{text}</span>
            <button
              type="button"
              className="chip-remove"
              aria-label={t("quickAdd.removeChip", { label: text })}
              onClick={() => onRemove(token.key)}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
