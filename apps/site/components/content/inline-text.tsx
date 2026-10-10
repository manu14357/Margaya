import { Fragment } from "react";

/**
 * Renders guide copy, where `backticks` mark keys, syntax, paths and
 * variables. Everything else is plain text; no other markup is interpreted.
 */
export function InlineText({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <code
            className="rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
            // biome-ignore lint/suspicious/noArrayIndexKey: segments of one fixed string, never reordered.
            key={index}
          >
            {part}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one fixed string, never reordered.
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
