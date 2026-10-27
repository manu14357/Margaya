import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SearchSnippet = {
  text: string;
  /** [start, end) offsets in UTF-16 code units, as the API returns them. */
  highlights: Array<{ start: number; end: number }>;
};

/**
 * A search snippet with its matched words marked. The API sends plain text
 * plus ranges, never markup, so user content is rendered as text only.
 */
export function HighlightedSnippet({
  snippet,
  className,
}: {
  snippet: SearchSnippet;
  className?: string;
}) {
  const { text } = snippet;
  const parts: ReactNode[] = [];
  let cursor = 0;
  const ranges = [...snippet.highlights].sort((a, b) => a.start - b.start);
  for (const { start, end } of ranges) {
    // Ranges past the text, inverted or overlapping a previous one are
    // dropped instead of rendering garbled text.
    if (start < cursor || end <= start || end > text.length) continue;
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={start}
        className="rounded-[2px] bg-primary/10 px-px font-medium text-foreground"
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className={cn("break-words", className)}>{parts}</span>;
}
