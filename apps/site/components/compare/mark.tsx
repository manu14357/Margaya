import type { Mark } from "@/lib/comparisons";
import { cn } from "@/lib/utils";

export const MARK_LABEL: Record<Mark, string> = {
  yes: "Yes",
  partial: "Partly",
  no: "No",
};

/**
 * A yes / partly / no glyph. Shape carries the meaning as well as tone, so it
 * reads without colour, and the text label is always present for screen
 * readers (or visible when `showLabel` is set, as in the legend).
 */
export function MarkIcon({
  mark,
  showLabel = false,
  className,
}: {
  mark: Mark;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className={cn(
          "size-5 shrink-0",
          mark === "no" ? "text-muted-foreground/60" : "text-foreground",
        )}
      >
        {mark === "yes" ? (
          <>
            <circle cx="10" cy="10" r="9" fill="currentColor" />
            <path
              d="M6 10.2l2.6 2.6L14 7.4"
              fill="none"
              stroke="var(--background)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : mark === "partial" ? (
          <>
            <circle
              cx="10"
              cy="10"
              r="8.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M10 1.75a8.25 8.25 0 0 0 0 16.5z" fill="currentColor" />
          </>
        ) : (
          <>
            <circle
              cx="10"
              cy="10"
              r="8.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M7.2 7.2l5.6 5.6M12.8 7.2l-5.6 5.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        )}
      </svg>
      <span className={showLabel ? "text-sm" : "sr-only"}>
        {MARK_LABEL[mark]}
      </span>
    </span>
  );
}
