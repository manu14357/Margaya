import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import {
  formatDateMedium,
  formatDateShort,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/format";
import { compactDateKind } from "@/lib/middle-truncate";

type CompactDateProps = {
  value: Date | string | number;
  className?: string;
};

/**
 * A date for dense lists: "3 hours ago" within a week, "Oct 3" this year,
 * "Oct 3, 2024" before. The exact date and time is in the tooltip and is what
 * screen readers hear.
 */
export function CompactDate({ value, className }: CompactDateProps) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const kind = compactDateKind(date, new Date());
  const label =
    kind === "relative"
      ? formatRelativeTime(date)
      : kind === "short"
        ? formatDateShort(date)
        : formatDateMedium(date);
  const exact = formatDateTime(date);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={date.toISOString()}
            className={cn("cursor-default whitespace-nowrap", className)}
          />
        }
      >
        <span aria-hidden>{label}</span>
        <span className="sr-only">{exact}</span>
      </TooltipTrigger>
      <TooltipContent>{exact}</TooltipContent>
    </Tooltip>
  );
}
