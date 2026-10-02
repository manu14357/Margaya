import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type WidgetSectionProps = {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** The shell every Home widget renders in: a labelled section and a header. */
export default function WidgetSection({
  title,
  actions,
  children,
  className,
}: WidgetSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("space-y-3", className)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2
          id={headingId}
          className="text-sm font-medium text-muted-foreground"
        >
          {title}
        </h2>
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
