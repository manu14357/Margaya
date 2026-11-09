import type { ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { useShell } from "@/components/common/shell-context";
import { cn } from "@/lib/cn";

const motion =
  "-translate-x-1/2 left-1/2 z-50 w-max transition-[translate,opacity] duration-200 ease-out starting:translate-y-3 starting:opacity-0 motion-reduce:starting:translate-y-0";

/**
 * Pins a bulk-selection bar to the bottom centre of the shell's main column,
 * so it centres on the board or list rather than the window and never spills
 * over the rail or the context panel. Outside the shell it pins to the window.
 */
export function BulkBarFrame({
  ref,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const mainColumn = useShell()?.mainColumn ?? null;
  const frame = (
    <div
      ref={ref}
      className={cn(
        motion,
        mainColumn
          ? "absolute bottom-6 max-w-[calc(100%-1rem)]"
          : "fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-w-[calc(100vw-1rem)] md:bottom-6",
      )}
    >
      {children}
    </div>
  );
  return mainColumn ? createPortal(frame, mainColumn) : frame;
}
