import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The flat frame every product screenshot sits in: a thin border, a rounded
 * corner and a hairline shadow. No tilt, glow or backdrop.
 */
export function ScreenFrame({
  children,
  caption,
  className,
}: {
  children: ReactNode;
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn("m-0", className)}>
      <div className="overflow-hidden rounded-xl border border-border bg-muted shadow-xs">
        {children}
      </div>
      {caption ? (
        <figcaption className="mt-3 text-muted-foreground text-sm">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
