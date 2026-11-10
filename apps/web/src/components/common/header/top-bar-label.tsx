import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useTopBarDensity } from "./top-bar-density";

/**
 * A top-bar button's text: shown while the bar has room, read by screen
 * readers only once the bar is compact, so the button becomes its icon.
 * `className` applies while visible (e.g. "hidden sm:inline").
 */
export function TopBarLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const density = useTopBarDensity();
  return (
    <span className={cn(density === "full" ? className : "sr-only")}>
      {children}
    </span>
  );
}

/**
 * Secondary top-bar content (steppers, badges, shortcuts that also live in a
 * menu): rendered only while the bar has room for everything, or, with
 * `hideWhen="tight"`, until only the essentials fit.
 */
export function TopBarRoomy({
  children,
  hideWhen = "compact",
}: {
  children: ReactNode;
  hideWhen?: "compact" | "tight";
}) {
  const density = useTopBarDensity();
  const hidden =
    density === "tight" || (hideWhen === "compact" && density === "compact");
  return hidden ? null : children;
}
