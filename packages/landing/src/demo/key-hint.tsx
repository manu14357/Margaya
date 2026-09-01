"use client";

import { cn } from "../lib/cn";

/** The chip that shows which keys the script pressed, e.g. "Ctrl+K". */
export function KeyHint({
  combo,
  visible,
}: {
  combo: string;
  visible: boolean;
}) {
  const keys = combo ? combo.split("+") : [];
  return (
    <div
      aria-hidden
      data-visible={visible}
      className={cn(
        "pointer-events-none absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover/95 p-1.5 shadow-lg transition-[opacity,translate] duration-200 ease-out",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      {keys.map((key, index) => (
        <kbd
          // Keys repeat rarely; the index keeps "Shift+Shift" safe.
          // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered list.
          key={index}
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border bg-muted px-2 font-medium font-sans text-foreground text-sm"
        >
          {key}
        </kbd>
      ))}
    </div>
  );
}
