import { cn } from "@/lib/cn";

export type IllustrationProps = Omit<React.ComponentProps<"svg">, "children">;

/**
 * The shared frame for state illustrations. Lines draw in `currentColor`
 * (muted foreground by default) and fills use palette utilities only, so the
 * drawings follow the theme without adding colours.
 */
export function IllustrationSvg({
  className,
  viewBox = "0 0 160 120",
  children,
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-auto w-44 text-muted-foreground", className)}
      data-slot="illustration"
      fill="none"
      focusable="false"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox={viewBox}
      {...props}
    >
      {children}
    </svg>
  );
}
