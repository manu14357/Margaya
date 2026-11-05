"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

// The one selected state for every segmented control: raised on the tray with
// a border and full-strength text, like the Tabs primitive's indicator. An
// unselected segment has no fill of its own, so it can't read as the chosen one.
const toggleVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-medium text-base text-muted-foreground outline-none transition-colors pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-pressed:border-border data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs/5 dark:data-pressed:bg-input sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
    },
    variants: {
      // Heights leave room for the tray's padding, so a tray of `sm` segments
      // is as tall as a small button (h-8, then sm:h-7).
      size: {
        default: "h-8 min-w-8 px-[calc(--spacing(2)-1px)] sm:h-7 sm:min-w-7",
        lg: "h-9 min-w-9 px-[calc(--spacing(2.5)-1px)] sm:h-8 sm:min-w-8",
        sm: "h-7 min-w-7 px-[calc(--spacing(2)-1px)] text-xs sm:h-6 sm:min-w-6 sm:text-xs",
      },
    },
  },
);

function Toggle({
  className,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size }))}
      data-slot="toggle"
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
