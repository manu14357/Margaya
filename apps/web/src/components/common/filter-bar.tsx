import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FilterBarProps = {
  /** Filter chips and the Filter button, left to right. Scrolls on phones. */
  children?: ReactNode;
  /** Right-aligned controls, e.g. Display or Sort. */
  trailing?: ReactNode;
  className?: string;
};

/**
 * The lens bar under the view tabs: filter chips on the left, display
 * controls on the right. Render it only where filtering applies.
 */
export function FilterBar({ children, trailing, className }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex min-h-10 shrink-0 items-center gap-1.5 border-border/80 border-b bg-background px-2 py-1.5 md:px-3",
        className,
      )}
      data-slot="filter-bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {children}
      </div>
      {trailing && (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      )}
    </div>
  );
}
