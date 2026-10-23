import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary:
    "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  outline:
    "border-input bg-popover text-foreground hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
} as const;

/**
 * A call-to-action link that matches the landing buttons, for pages that
 * render outside the landing providers (server components).
 */
export function CtaLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"a"> & { variant?: keyof typeof VARIANTS }) {
  return (
    <a
      className={cn(
        "inline-flex h-12 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
