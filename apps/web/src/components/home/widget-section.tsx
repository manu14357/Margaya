import type { LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type WidgetSectionProps = {
  title: string;
  /** The widget's icon, shown on a chip tinted with `tone`. */
  icon?: LucideIcon;
  /** An area hue such as `var(--area-work)`. */
  tone?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * The card every Home widget renders in: a labelled section whose header
 * carries the widget's icon chip in its area colour.
 */
export default function WidgetSection({
  title,
  icon: Icon,
  tone = "var(--area-home)",
  actions,
  children,
  className,
}: WidgetSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "space-y-3 rounded-xl border bg-card p-3 shadow-xs sm:p-4",
        className,
      )}
    >
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)`,
                color: tone,
              }}
            >
              <Icon className="size-4" />
            </span>
          )}
          <h2
            id={headingId}
            className="truncate font-semibold text-foreground text-sm"
          >
            {title}
          </h2>
        </div>
        {actions ? (
          <div className="flex items-center gap-1">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The compact muted panel widgets show when they have nothing yet. */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** An inline load error with a retry button. */
export function WidgetError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{message}</span>
      <Button variant="ghost" size="xs" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
