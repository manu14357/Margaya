"use client";

import type { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";
import { Separator } from "@/components/ui/separator";
import {
  Toggle as ToggleComponent,
  type toggleVariants,
} from "@/components/ui/toggle";
import { cn } from "@/lib/cn";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
});

/**
 * The app's segmented control. `variant="outline"` sits the segments in a
 * tray; `default` leaves them on the page. Every segmented control is built
 * from this, so the selected state stays the same everywhere.
 */
function ToggleGroup({
  className,
  variant = "default",
  size = "default",
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    variant?: "default" | "outline";
  }) {
  return (
    <ToggleGroupPrimitive
      className={cn(
        "flex w-fit gap-0.5 *:focus-visible:z-10",
        // Neighbouring segments share an edge, so a coarse pointer's larger
        // hit area only grows across the row, never over the next segment.
        orientation === "horizontal"
          ? "*:pointer-coarse:after:min-w-auto"
          : "flex-col *:pointer-coarse:after:min-h-auto",
        variant === "outline" && "rounded-lg bg-muted p-0.5",
        className,
      )}
      data-size={size}
      data-slot="toggle-group"
      data-variant={variant}
      orientation={orientation}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function Toggle({
  className,
  children,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  const resolvedSize = context.size || size;

  return (
    <ToggleComponent
      className={className}
      data-size={resolvedSize}
      size={resolvedSize}
      {...props}
    >
      {children}
    </ToggleComponent>
  );
}

function ToggleGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: {
  className?: string;
} & React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        "pointer-events-none relative bg-input before:absolute before:inset-0 dark:before:bg-input/32",
        className,
      )}
      orientation={orientation}
      {...props}
    />
  );
}

export { Toggle, Toggle as ToggleGroupItem, ToggleGroup, ToggleGroupSeparator };
