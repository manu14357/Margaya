import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { FilterGroupOp } from "@/lib/task-query/model";

type MatchPillProps = {
  op: FilterGroupOp;
  onChange: (op: FilterGroupOp) => void;
  disabled?: boolean;
};

/** "Match all" / "Match any": how the root conditions combine. */
export default function MatchPill({ op, onChange, disabled }: MatchPillProps) {
  const { t } = useTranslation();
  const item = (value: FilterGroupOp, label: string) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={op === value}
      onClick={() => onChange(value)}
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 font-medium text-xs transition-colors",
        op === value
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex h-7 items-center gap-0.5 rounded-md border border-border bg-background px-0.5">
      {item("and", t("tasks:filters.matchAll"))}
      {item("or", t("tasks:filters.matchAny"))}
    </div>
  );
}
