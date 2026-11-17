import { useMemo } from "react";
import { splitLines } from "../components/line-view";
import { TextDocument } from "../components/text-document";
import { FileCard } from "../components/ui";
import { usePreview } from "../context";
import { decodeText, looksBinary } from "../load";
import type { RendererProps } from "../types";

function hasUnicodeBom(bytes: Uint8Array) {
  return (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  );
}

/** Plain text, logs and config files: numbered lines, never markup. */
export default function TextRenderer({
  source,
  bytes,
  truncated,
}: RendererProps) {
  const { labels } = usePreview();
  const data = bytes ?? new Uint8Array();
  const binary = !hasUnicodeBom(data) && looksBinary(data);
  const lines = useMemo(
    () => (binary ? [] : splitLines(decodeText(data))),
    [binary, data],
  );
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
    <TextDocument
      lines={lines}
      label={source.name}
      truncatedAt={truncated ? data.byteLength : undefined}
    />
  );
}
