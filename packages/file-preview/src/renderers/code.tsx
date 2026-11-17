import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type LineToken, splitLines } from "../components/line-view";
import { TextDocument } from "../components/text-document";
import { FileCard, LoadingState, Notice } from "../components/ui";
import { usePreview } from "../context";
import { HIGHLIGHT_LIMIT } from "../limits";
import { decodeText, looksBinary } from "../load";
import type { RendererProps } from "../types";
import { highlightLines } from "./highlighter";

/** Valid JSON, re-indented for reading; anything else as it was. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * Highlighted, numbered, read-only code. Large files skip highlighting
 * (with a notice) and stay plain text.
 */
export function CodeBody({
  text,
  language,
  label,
  truncatedAt,
  tools,
}: {
  text: string;
  language?: string;
  label: string;
  truncatedAt?: number;
  tools?: ReactNode;
}) {
  const { labels, theme } = usePreview();
  const lines = useMemo(() => splitLines(text), [text]);
  const tooLarge =
    text.length > HIGHLIGHT_LIMIT.bytes || lines.length > HIGHLIGHT_LIMIT.lines;
  const highlight = Boolean(language) && language !== "text" && !tooLarge;
  const [tokens, setTokens] = useState<{
    theme: string;
    lines: LineToken[][] | null;
  } | null>(null);

  useEffect(() => {
    if (!highlight || !language) return;
    let cancelled = false;
    // Let the loading state paint before the (synchronous) tokenising.
    const timer = setTimeout(() => {
      highlightLines(lines.join("\n"), language, theme)
        .then((result) => {
          if (!cancelled) setTokens({ theme, lines: result });
        })
        .catch(() => {
          if (!cancelled) setTokens({ theme, lines: null });
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [highlight, language, lines, theme]);

  if (highlight && tokens === null) return <LoadingState />;
  return (
    <TextDocument
      lines={lines}
      // A theme switch keeps the old colours until the new ones are ready.
      tokens={highlight ? tokens?.lines : null}
      label={label}
      truncatedAt={truncatedAt}
      tools={tools}
      notices={
        tooLarge && language && language !== "text" ? (
          <Notice>{labels.plainText}</Notice>
        ) : null
      }
    />
  );
}

/** Source code and structured data (JSON, XML, YAML, …). */
export default function CodeRenderer({
  source,
  file,
  bytes,
  truncated,
}: RendererProps) {
  const { labels } = usePreview();
  const data = bytes ?? new Uint8Array();
  const binary = looksBinary(data);
  const text = useMemo(() => {
    if (binary) return "";
    const decoded = decodeText(data);
    return file.language === "json" && !truncated
      ? prettyJson(decoded)
      : decoded;
  }, [binary, data, file.language, truncated]);
  if (binary) {
    return (
      <FileCard
        name={source.name}
        size={source.size}
        message={labels.noPreview}
      />
    );
  }
  return (
    <CodeBody
      text={text}
      language={file.language}
      label={source.name}
      truncatedAt={truncated ? data.byteLength : undefined}
    />
  );
}
