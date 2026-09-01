import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The app's success toast, pinned to the bottom of the replica. It slides
 * in when `open` turns true (a CSS transition, so it costs no script).
 */
export function NoticeToast({
  open,
  children,
  action,
  className,
}: {
  open: boolean;
  children: ReactNode;
  /** A trailing action, e.g. "My requests". */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none absolute right-[var(--demo-controls-inset,1rem)] bottom-4 z-30 flex items-center gap-2 rounded-lg border border-border bg-popover py-2.5 ps-3 pe-3 text-popover-foreground text-sm shadow-lg transition-[opacity,transform] duration-300 ease-out",
        open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        className,
      )}
    >
      <CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
      <span className="font-medium">{children}</span>
      {action && (
        <span className="ms-2 rounded-md border border-border px-2 py-0.5 font-medium text-xs">
          {action}
        </span>
      )}
    </div>
  );
}
