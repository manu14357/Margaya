import { type ReactNode, useLayoutEffect, useRef } from "react";
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
  const ref = useRef<HTMLSpanElement>(null);
  const iconOnly = density !== "full";

  // An icon-only button still says what it does on hover: while the label
  // is hidden, its control shows it as a tooltip (unless it has its own).
  useLayoutEffect(() => {
    const control = ref.current?.closest<HTMLElement>("button, a");
    if (!iconOnly || !control || control.hasAttribute("title")) return;
    // A control with a tooltip of its own keeps just that one.
    if (control.dataset.slot === "tooltip-trigger") return;
    const text = ref.current?.textContent?.trim();
    if (!text) return;
    control.setAttribute("title", text);
    control.setAttribute(LABEL_TITLE, "");
    return () => {
      if (!control.hasAttribute(LABEL_TITLE)) return;
      control.removeAttribute("title");
      control.removeAttribute(LABEL_TITLE);
    };
  });

  return (
    <span ref={ref} className={cn(iconOnly ? "sr-only" : className)}>
      {children}
    </span>
  );
}

/** Marks a title TopBarLabel set, so it removes only its own. */
const LABEL_TITLE = "data-top-bar-label-title";

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
