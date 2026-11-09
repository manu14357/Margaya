import { useNavigate } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/cn";
import { stripModelTokens } from "@/lib/model-tokens";
import { resolveSafeLink } from "@/lib/safe-link";

const NEW_TAB_LINKS: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),
};

/** A link that stays in the app, opens an http(s) page, or is plain text. */
function SafeLink({ href, children }: { href?: string; children: ReactNode }) {
  const navigate = useNavigate();
  const link = resolveSafeLink(href);
  if (!link) return <span>{children}</span>;
  if (link.kind === "web") {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  }
  // Plain clicks navigate in place; modified ones are left to the browser.
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    void navigate({ href: link.href });
  };
  return (
    <a href={link.href} onClick={open}>
      {children}
    </a>
  );
}

const SAFE_LINKS: Components = {
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  // No remote fetches from written text: an image is its description.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

/**
 * AI-written Markdown, rendered as plain formatting. Raw HTML in the answer
 * is never rendered (react-markdown's default), nor are a model's control
 * tokens, and links open in a new tab.
 * With `safeLinks`, links into the app navigate in place, only http(s) links
 * leave it, any other link is plain text, and images show their alt text.
 */
export default function AiMarkdown({
  text,
  className,
  safeLinks = false,
}: {
  text: string;
  className?: string;
  safeLinks?: boolean;
}) {
  return (
    <div
      className={cn(
        "break-words text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-semibold [&_h1]:text-base [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-semibold [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:ps-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:ps-5 [&>*:first-child]:mt-0",
        className,
      )}
    >
      <ReactMarkdown components={safeLinks ? SAFE_LINKS : NEW_TAB_LINKS}>
        {stripModelTokens(text)}
      </ReactMarkdown>
    </div>
  );
}
