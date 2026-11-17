import { useLayoutEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { splitForMiddleTruncation } from "@/lib/middle-truncate";

type TruncatedTextProps = {
  text: string;
  /** Keep the end visible: an email's domain, an id's last characters. */
  middle?: boolean;
  className?: string;
};

/**
 * One line of text that ends in "…" when it does not fit. The full text stays
 * in the DOM for screen readers; once it is cut, the text can take focus and
 * shows the whole value in a tooltip on hover and on keyboard focus.
 */
export function TruncatedText({
  text,
  middle = false,
  className,
}: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: new text can change the fit without resizing the element
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const check = () =>
      setTruncated(element.scrollWidth > element.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  const { head, tail } = middle
    ? splitForMiddleTruncation(text)
    : { head: text, tail: "" };

  return (
    <Tooltip disabled={!truncated}>
      <TooltipTrigger
        // Focusable only while cut, so keyboard users can reach the value
        // without a tab stop on every cell that fits.
        tabIndex={truncated ? 0 : undefined}
        data-truncated={truncated || undefined}
        render={
          <span
            className={cn(
              "flex min-w-0 max-w-full rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
          />
        }
      >
        <span ref={ref} className="min-w-0 truncate">
          {head}
        </span>
        {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
      </TooltipTrigger>
      <TooltipContent className="max-w-80 break-all">{text}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Middle truncation without a tab stop or tooltip, for text inside a button
 * or link (which already takes focus). The title carries the full value for
 * the mouse; the full text stays in the DOM for screen readers.
 */
export function MiddleTruncate({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { head, tail } = splitForMiddleTruncation(text);
  return (
    <span title={text} className={cn("flex min-w-0 max-w-full", className)}>
      <span className="min-w-0 truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  );
}
