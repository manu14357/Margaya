import { PenTool } from "lucide-react";
import { cn } from "@/lib/cn";

/** A board's emoji, or the section's pen icon when it has none. */
export default function WhiteboardIcon({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  if (icon) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center text-[0.95rem] leading-none",
          className,
        )}
      >
        {icon}
      </span>
    );
  }
  return (
    <PenTool
      aria-hidden="true"
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  );
}
