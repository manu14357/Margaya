"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function CodeBlock({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the text is still selectable.
    }
  };

  return (
    <figure className="overflow-hidden rounded-xl border border-border/80 bg-card">
      <figcaption className="flex items-center justify-between gap-3 border-border/70 border-b bg-muted/40 py-1.5 pr-1.5 pl-4">
        <span className="truncate font-mono text-muted-foreground text-xs">
          {label}
        </span>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onClick={copy}
          type="button"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </figcaption>
      <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] text-foreground leading-relaxed">
        <code>{content}</code>
      </pre>
    </figure>
  );
}
