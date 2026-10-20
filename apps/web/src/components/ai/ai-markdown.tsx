import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/cn";

/**
 * AI-written Markdown, rendered as plain formatting. Raw HTML in the answer
 * is never rendered (react-markdown's default), and links open in a new tab.
 */
export default function AiMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "break-words text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-semibold [&_h1]:text-base [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-semibold [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-5 [&>*:first-child]:mt-0",
        className,
      )}
    >
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
