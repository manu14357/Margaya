import { ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";

type CollapsibleSectionProps = {
  title: string;
  icon: LucideIcon;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** A collapsible group of a planning list, like the backlog's sections. */
export function CollapsibleSection({
  title,
  icon: Icon,
  count,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const panelId = useId();
  return (
    <section className="border-border/50 border-b">
      <div className="sticky top-0 z-10 flex h-8 items-center border-border/50 border-b bg-muted px-3 md:px-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex items-center gap-1.5 rounded-sm font-semibold text-[11px] text-muted-foreground uppercase tracking-wide outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
          <Icon className="size-3.5 shrink-0" />
          <span>{title}</span>
          {count !== undefined && (
            <span className="font-medium tabular-nums">{count}</span>
          )}
        </button>
      </div>
      {open && (
        <div id={panelId} className="bg-card">
          {children}
        </div>
      )}
    </section>
  );
}

/** Placeholder rows while a planning list (cycles, modules) loads. */
export function PlanningRowSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: count }, (_, index) => `skeleton-${index}`).map(
        (key) => (
          <div key={key} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-20" />
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-4 w-10" />
          </div>
        ),
      )}
    </div>
  );
}
