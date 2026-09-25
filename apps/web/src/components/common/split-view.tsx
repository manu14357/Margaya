import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SplitViewProps = {
  /** The primary pane: a list, a queue, a backlog. */
  primary: ReactNode;
  /** The secondary pane: a preview, a reader, the sprint. */
  secondary: ReactNode;
  /**
   * Under 1024px only one pane fits. True shows the secondary pane (a row
   * was opened), false the primary one. Wide screens always show both.
   */
  showSecondary?: boolean;
  /** The primary pane's width from 1024px up. Defaults to "md" (400px). */
  primaryWidth?: "sm" | "md" | "lg" | "half";
  /** Accessible names for the two panes. */
  primaryLabel?: string;
  secondaryLabel?: string;
  className?: string;
};

const PRIMARY_WIDTHS = {
  sm: "lg:w-80",
  md: "lg:w-100",
  lg: "lg:w-120",
  half: "lg:w-1/2",
} as const;

/**
 * Two panes side by side (inbox reader, triage queue, cycle planner).
 * Each pane scrolls on its own. Below 1024px it shows one pane at a time,
 * chosen by `showSecondary`; the page provides the way back.
 */
export function SplitView({
  primary,
  secondary,
  showSecondary = false,
  primaryWidth = "md",
  primaryLabel,
  secondaryLabel,
  className,
}: SplitViewProps) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 overflow-hidden", className)}
      data-slot="split-view"
    >
      <section
        aria-label={primaryLabel}
        className={cn(
          "min-h-0 w-full shrink-0 flex-col overflow-y-auto overscroll-contain lg:flex lg:border-border/80 lg:border-r",
          PRIMARY_WIDTHS[primaryWidth],
          showSecondary ? "hidden" : "flex",
        )}
        data-slot="split-view-primary"
      >
        {primary}
      </section>
      <section
        aria-label={secondaryLabel}
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:flex",
          showSecondary ? "flex" : "hidden",
        )}
        data-slot="split-view-secondary"
      >
        {secondary}
      </section>
    </div>
  );
}
