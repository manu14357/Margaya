import { ChevronDown, ChevronUp, Maximize2, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { StatusChip, type StatusId } from "./chips";

export type SheetProperty = {
  id: string;
  label: ReactNode;
  value: ReactNode;
};

/** A property value as the sheet's ghost button: icon, then text. */
export function PropertyValue({
  icon,
  children,
  muted = false,
  "data-demo": target,
}: {
  icon?: ReactNode;
  children: ReactNode;
  muted?: boolean;
  "data-demo"?: string;
}) {
  return (
    <span
      data-demo={target}
      className={cn(
        "inline-flex h-7 max-w-full items-center justify-start gap-1.5 rounded-lg px-1.5 font-medium text-xs",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * The task as a right sheet over the view: header (key, status, stepper,
 * close), title, description, then the two-column property grid.
 * Render it inside a `relative` page area; it slides in when `open`.
 */
export function TaskSheet({
  open,
  taskKey,
  status,
  title,
  description,
  properties,
  propertiesLabel,
  closeLabel,
  footer,
  onClose,
  className,
}: {
  open: boolean;
  taskKey: string;
  status: { id: StatusId; label: ReactNode };
  title: ReactNode;
  description?: ReactNode;
  properties: readonly SheetProperty[];
  propertiesLabel: ReactNode;
  closeLabel: string;
  /** e.g. an activity line under the properties. */
  footer?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <aside
      data-demo="task-sheet"
      data-open={open}
      aria-hidden={!open}
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex w-[440px] max-w-full flex-col border-border border-l bg-background shadow-black/10 shadow-xl transition-[translate,opacity] duration-300 ease-out",
        open
          ? "translate-x-0 opacity-100"
          : "pointer-events-none translate-x-full opacity-0",
        className,
      )}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-medium font-mono text-muted-foreground text-xs">
            {taskKey}
          </span>
          <StatusChip status={status.id} label={status.label} />
          <span className="ml-1 flex items-center text-muted-foreground">
            <ChevronUp aria-hidden className="size-4" />
            <ChevronDown aria-hidden className="size-4" />
          </span>
        </div>
        <span className="flex size-7 items-center justify-center rounded-md text-muted-foreground">
          <Maximize2 aria-hidden className="size-3.5" />
        </span>
        <button
          type="button"
          aria-label={closeLabel}
          tabIndex={open ? undefined : -1}
          onClick={onClose}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden p-5">
        <h3 className="font-heading font-semibold text-2xl text-foreground leading-[1.15] tracking-[-0.02em]">
          {title}
        </h3>
        {description && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {description}
          </p>
        )}
        <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/80 p-3">
          <h4 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
            {propertiesLabel}
          </h4>
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3">
            {properties.map((property) => (
              <div
                key={property.id}
                data-demo={`property-${property.id}`}
                className="col-span-2 grid min-h-8 grid-cols-subgrid items-center"
              >
                <dt className="truncate text-muted-foreground text-xs">
                  {property.label}
                </dt>
                <dd className="-ml-1.5 flex min-w-0 flex-wrap items-center gap-1">
                  {property.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        {footer}
      </div>
    </aside>
  );
}
