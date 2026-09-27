import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Small building blocks of the task filter bar, shared with the planning
// screens' own filter menus.

export function CheckSlot({ checked }: { checked: boolean }) {
  return (
    <span
      className={`inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background"
      }`}
    >
      {checked ? "✓" : null}
    </span>
  );
}

type ActiveFilterChipProps = {
  subject: string;
  operator: ReactNode;
  /** Left out for operators that take no value (is empty). */
  value?: ReactNode;
  onClear: () => void;
  /** Accessible name of the clear button, e.g. "Remove filter Status". */
  clearLabel?: string;
  className?: string;
};

export function ActiveFilterChip({
  subject,
  operator,
  value,
  onClear,
  clearLabel,
  className,
}: ActiveFilterChipProps) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center rounded-md border border-border bg-background text-xs shadow-xs",
        className,
      )}
    >
      <span className="px-2 font-medium text-foreground">{subject}</span>
      <span className="h-full w-px bg-border" />
      {typeof operator === "string" ? (
        <span className="px-2 text-foreground/80">{operator}</span>
      ) : (
        operator
      )}
      {value !== undefined && value !== null && (
        <>
          <span className="h-full w-px bg-border" />
          {typeof value === "string" ? (
            <span className="flex px-2 text-foreground">{value}</span>
          ) : (
            value
          )}
        </>
      )}
      <span className="h-full w-px bg-border" />
      <button
        aria-label={clearLabel}
        className="inline-flex h-full w-7 items-center justify-center rounded-r-md text-foreground/70 hover:bg-accent/70 hover:text-foreground"
        onClick={onClear}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The muted "?" circle that stands for "no assignee". */
export function UnassignedCircle({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-full border border-border bg-muted font-medium text-[9px] text-muted-foreground",
        className,
      )}
    >
      ?
    </span>
  );
}

export function StackedIcons({
  items,
  itemClassName,
}: {
  items: Array<{ id: string; node: ReactNode }>;
  itemClassName?: string;
}) {
  if (items.length === 0) return null;

  return (
    <span className="inline-flex items-center -space-x-1.5">
      {items.slice(0, 3).map((item) => (
        <span
          key={item.id}
          className={`inline-flex size-4 items-center justify-center rounded-full bg-background ${
            itemClassName ?? ""
          }`}
        >
          {item.node}
        </span>
      ))}
    </span>
  );
}

/** A filter menu row: check slot, optional icon, label. */
export function FilterOptionRow({
  checked,
  icon,
  label,
  onClick,
  className,
}: {
  checked: boolean;
  icon?: ReactNode;
  label: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={cn(
        "inline-flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs",
        checked
          ? "bg-accent text-accent-foreground"
          : "text-foreground/90 hover:bg-accent/60 hover:text-foreground",
        className,
      )}
      onClick={onClick}
      type="button"
      aria-pressed={checked}
    >
      <CheckSlot checked={checked} />
      {icon && (
        <span className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-3.5">
          {icon}
        </span>
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
