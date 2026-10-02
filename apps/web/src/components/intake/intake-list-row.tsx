import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { getInitials } from "@/lib/get-initials";
import { effectiveIntakeStatus, formatIntakeKey } from "@/lib/intake";
import { formatSnoozeDay } from "@/lib/intake-snooze";
import { getPriorityIcon } from "@/lib/priority";
import type { IntakeItem } from "@/types/intake";
import IntakeStatusBadge from "./intake-status-badge";

type IntakeListRowProps = {
  item: IntakeItem;
  selected: boolean;
  onSelect: (item: IntakeItem) => void;
};

/** One request: key and status, the title, then who sent it and when. */
export default function IntakeListRow({
  item,
  selected,
  onSelect,
}: IntakeListRowProps) {
  const { t } = useTranslation();
  const status = effectiveIntakeStatus(item);
  const submitter = item.submittedBy;
  const submitterName = submitter?.name ?? t("common:people.someone");

  let detail = formatRelativeTime(item.createdAt);
  if (status === "snoozed" && item.snoozedUntil) {
    detail = t("intake:status.snoozedUntil", {
      date: formatSnoozeDay(item.snoozedUntil),
    });
  } else if (status === "accepted") {
    detail = item.task.columnName
      ? t("intake:list.acceptedInto", { column: item.task.columnName })
      : t("intake:list.acceptedIntoBacklog");
  }

  return (
    <li>
      <button
        type="button"
        data-intake-item-id={item.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(item)}
        className={cn(
          "flex w-full flex-col gap-1 border-border/60 border-b px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          selected && "bg-accent hover:bg-accent",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatIntakeKey(item.task.key)}
          </span>
          {status !== "pending" && <IntakeStatusBadge status={status} />}
          <span className="ms-auto flex shrink-0 items-center">
            {getPriorityIcon(item.task.priority)}
          </span>
        </span>
        <span className="line-clamp-2 text-sm">{item.task.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <Avatar className="size-4 shrink-0">
            <AvatarImage src={submitter?.image ?? ""} alt={submitterName} />
            <AvatarFallback className="bg-muted text-[8px]">
              {getInitials(submitterName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{submitterName}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{detail}</span>
        </span>
      </button>
    </li>
  );
}
