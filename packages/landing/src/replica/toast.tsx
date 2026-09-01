import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * The app's success toast, pinned to the bottom right of the replica. Mount
 * it to show it: it slides in on mount.
 */
export function ReplicaToast({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      data-demo="toast"
      className={cn(
        "absolute right-[var(--demo-controls-inset,3.5rem)] bottom-4 z-30 flex w-72 items-center gap-2 rounded-lg border border-border bg-popover px-3.5 py-3 text-popover-foreground text-sm shadow-lg/5 transition-[translate,opacity] duration-300 ease-out starting:translate-y-3 starting:opacity-0",
        className,
      )}
    >
      <CircleCheck
        aria-hidden
        className="size-4 shrink-0 text-success-foreground"
      />
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}
