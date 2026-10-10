"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Copies `value` to the clipboard and says so for two seconds, visibly and
 * through a polite live region.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  className,
  children,
}: {
  value: string;
  /** The button text, and its accessible name when `children` is given. */
  label: string;
  copiedLabel: string;
  className?: string;
  /** Replaces the default icon and label, e.g. a colour swatch. */
  children?: ReactNode;
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
      // Clipboard access can be refused (permissions, insecure origin); the
      // value stays visible next to the button for copying by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={children ? label : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        !children &&
          "h-8 border border-input bg-popover px-2.5 text-foreground shadow-xs/5 hover:bg-accent/50 dark:bg-input/32 dark:hover:bg-input/64",
        className,
      )}
    >
      {children ?? (
        <>
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          {copied ? copiedLabel : label}
        </>
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
