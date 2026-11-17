import { useEffect, useMemo, useState } from "react";
import { ModeToggle } from "../components/mode-toggle";
import { LoadingState, Notice, Toolbar } from "../components/ui";
import { usePreview } from "../context";
import { formatLabel } from "../labels";
import { formatBytes } from "../limits";
import { decodeText } from "../load";
import type { RendererProps } from "../types";
import { CodeBody } from "./code";
import { sanitizeMarkdownHtml } from "./sanitize";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Markdown rendered to HTML, then sanitised. Raw HTML in the file is shown
 * as text, never parsed, so a document can't smuggle markup in.
 */
export async function renderMarkdown(text: string): Promise<string> {
  const { Marked } = await import("marked");
  const marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      html({ text: raw }) {
        return escapeHtml(raw);
      },
    },
  });
  const html = marked.parse(text) as string;
  return sanitizeMarkdownHtml(html);
}

export default function MarkdownRenderer({
  source,
  bytes,
  truncated,
}: RendererProps) {
  const { labels } = usePreview();
  const data = bytes ?? new Uint8Array();
  const text = useMemo(() => decodeText(data), [data]);
  const [showSource, setShowSource] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    renderMarkdown(text)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  const toggle = (
    <ModeToggle source={showSource || failed} onChange={setShowSource} />
  );
  if (showSource || failed) {
    return (
      <CodeBody
        text={text}
        language="markdown"
        label={source.name}
        truncatedAt={truncated ? data.byteLength : undefined}
        tools={toggle}
      />
    );
  }
  return (
    <>
      <Toolbar>{toggle}</Toolbar>
      {truncated ? (
        <Notice>
          {formatLabel(labels.truncated, {
            size: formatBytes(data.byteLength),
          })}
        </Notice>
      ) : null}
      {html === null ? (
        <LoadingState />
      ) : (
        <section
          className="mfp-scroll mfp-doc-scroll"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable read-only region is reached and scrolled from the keyboard
          tabIndex={0}
          aria-label={source.name}
        >
          <article
            className="mfp-markdown"
            // Sanitised above: raw HTML escaped, then sanitised.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised markdown output
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </section>
      )}
    </>
  );
}
