import { useMemo, useState } from "react";
import { ModeToggle } from "../components/mode-toggle";
import { Notice, Toolbar } from "../components/ui";
import { usePreview } from "../context";
import { formatLabel } from "../labels";
import { formatBytes } from "../limits";
import { decodeText } from "../load";
import type { RendererProps } from "../types";
import { CodeBody } from "./code";
import { sanitizeHtmlDocument } from "./sanitize";

/**
 * An uploaded web page, sanitised and shown in a frame with every sandbox
 * permission withheld: no scripts, no same-origin access, no popups, no
 * navigation. Its own policy also stops it loading anything from outside.
 */
export default function HtmlRenderer({
  source,
  bytes,
  truncated,
}: RendererProps) {
  const { labels } = usePreview();
  const data = bytes ?? new Uint8Array();
  const text = useMemo(() => decodeText(data), [data]);
  const [showSource, setShowSource] = useState(false);
  const document = useMemo(
    () => (showSource ? "" : sanitizeHtmlDocument(text)),
    [showSource, text],
  );
  const toggle = <ModeToggle source={showSource} onChange={setShowSource} />;

  if (showSource) {
    return (
      <CodeBody
        text={text}
        language="html"
        label={source.name}
        truncatedAt={truncated ? data.byteLength : undefined}
        tools={toggle}
      />
    );
  }
  return (
    <>
      <Toolbar>{toggle}</Toolbar>
      <Notice>
        {labels.htmlNotice}
        {truncated
          ? ` ${formatLabel(labels.truncated, { size: formatBytes(data.byteLength) })}`
          : ""}
      </Notice>
      <div className="mfp-frame-wrap">
        <iframe
          className="mfp-frame"
          title={source.name}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={document}
        />
      </div>
    </>
  );
}
