import { fill } from "@/lib/desktop-system";
import { CopyValue } from "./copy-value";

export type CodeBlockCopy = {
  copy: string;
  copied: string;
  /** Accessible name of the copy button, with {{label}}. */
  copyLabel: string;
};

/**
 * Shell commands under a label, with a copy button. Long commands wrap
 * instead of scrolling, so nothing is ever cut off on a small screen.
 */
export function CodeBlock({
  label,
  lines,
  copy,
}: {
  label: string;
  lines: string[];
  copy: CodeBlockCopy;
}) {
  const text = lines.join("\n");
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card">
      <figcaption className="flex min-h-11 items-center justify-between gap-3 border-border border-b py-1.5 pr-1.5 pl-4">
        <span className="min-w-0 font-medium text-sm">{label}</span>
        <CopyValue
          value={text}
          label={copy.copy}
          copiedLabel={copy.copied}
          accessibleLabel={fill(copy.copyLabel, { label })}
        />
      </figcaption>
      <pre className="whitespace-pre-wrap bg-muted/40 px-4 py-3 font-mono text-xs sm:text-[0.8125rem] text-foreground/90 leading-relaxed [overflow-wrap:anywhere]">
        <code>{text}</code>
      </pre>
    </figure>
  );
}
