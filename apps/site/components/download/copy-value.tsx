"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A small copy button with its own accessible name, so several on one page
 * ("Copy commands: openSUSE") stay distinguishable to screen readers.
 */
export function CopyValue({
  value,
  label,
  accessibleLabel,
  copiedLabel,
  className,
}: {
  value: string;
  /** The visible text. */
  label: string;
  accessibleLabel: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the value stays visible to copy by
      // hand.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-input bg-popover px-2.5 font-medium text-foreground text-xs shadow-xs/5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background dark:bg-input/32 dark:hover:bg-input/64",
        className,
      )}
    >
      {copied ? (
        <Check aria-hidden className="size-3.5 text-primary" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      <span aria-hidden>{copied ? copiedLabel : label}</span>
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
