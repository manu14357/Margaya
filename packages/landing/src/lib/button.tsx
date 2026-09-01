"use client";

import type { ReactNode } from "react";
import { LandingLink } from "../links";
import { cn } from "./cn";

const VARIANTS = {
  primary:
    "border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs hover:bg-primary/90",
  outline:
    "border-input bg-popover text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
  ghost: "border-transparent text-foreground hover:bg-accent",
} as const;

const SIZES = {
  md: "h-9 px-3 text-sm",
  lg: "h-12 px-5 text-sm",
} as const;

/** A call-to-action link styled like the apps' buttons. */
export function LandingButton({
  href,
  variant = "primary",
  size = "lg",
  children,
  className,
}: {
  href: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <LandingLink
      href={href}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </LandingLink>
  );
}
