import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const WIDTHS = {
  /** Reading and forms: settings, a page's details. */
  narrow: "max-w-3xl",
  /** Dashboards and lists. */
  wide: "max-w-6xl",
  /** Boards, tables, timelines: edge to edge. */
  full: "max-w-none",
} as const;

export type ContentAreaProps = {
  children: ReactNode;
  /** Content width; centred when not "full". Defaults to "full". */
  width?: keyof typeof WIDTHS;
  /** Adds the canvas padding (16px, 24px from md). Defaults to true. */
  padded?: boolean;
  /** "auto": the area scrolls; "none": the child manages its own scroll. */
  scroll?: "auto" | "none";
  className?: string;
};

/**
 * The canvas under the top bar, tabs and filter bar: it takes the remaining
 * height and owns the vertical scroll.
 */
export function ContentArea({
  children,
  width = "full",
  padded = true,
  scroll = "auto",
  className,
}: ContentAreaProps) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        scroll === "auto"
          ? "overflow-y-auto overscroll-contain"
          : "overflow-hidden",
      )}
      data-slot="content-area"
    >
      <div
        className={cn(
          "mx-auto w-full",
          WIDTHS[width],
          padded && "px-4 py-4 md:px-6 md:py-5",
          scroll === "none" && "h-full",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
