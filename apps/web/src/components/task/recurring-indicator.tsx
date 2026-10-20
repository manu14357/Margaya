import { Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/** The quiet repeat mark on cards and rows: an icon, no colour. */
export function RecurringIndicator({ className }: { className?: string }) {
  const { t } = useTranslation();
  const label = t("tasks:recurrence.indicator");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center text-muted-foreground",
        className,
      )}
    >
      <Repeat aria-hidden className="size-3" />
    </span>
  );
}

export default RecurringIndicator;
