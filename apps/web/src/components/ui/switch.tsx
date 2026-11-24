"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@/lib/cn";

/**
 * A native button with role="switch", so `id` and a `<label htmlFor>` name
 * the visible control. (Base UI's default span puts `id` on its hidden input
 * instead, and the label then points at an element nobody can see.)
 */
function Switch({
  className,
  render,
  nativeButton,
  ...props
}: SwitchPrimitive.Root.Props) {
  const ownButton = render === undefined;
  return (
    <SwitchPrimitive.Root
      render={ownButton ? <button type="button" /> : render}
      nativeButton={ownButton ? true : nativeButton}
      className={cn(
        "relative inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-none transition-[background-color,box-shadow] duration-200 [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 pointer-coarse:after:absolute pointer-coarse:after:-inset-3 sm:[--thumb-size:--spacing(4)] pointer-coarse:[--thumb-size:--spacing(5)]",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block aspect-square h-full origin-left in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:not-data-disabled:scale-x-110 in-[[role=switch]:active,[data-slot=label]:active,[data-slot=field-label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] rounded-(--thumb-size) bg-background shadow-sm/5 will-change-transform [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s] data-checked:origin-[var(--thumb-size)_50%] data-checked:translate-x-[calc(var(--thumb-size)-4px)]",
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
