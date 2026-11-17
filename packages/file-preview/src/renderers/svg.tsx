import { useMemo } from "react";
import { ImageView } from "../components/image-view";
import { ErrorState } from "../components/ui";
import { useObjectUrl } from "../hooks";
import { decodeText } from "../load";
import type { RendererProps } from "../types";
import { sanitizeSvg } from "./sanitize";

/**
 * SVG, sanitised and then shown as a picture from its own blob: never put
 * into the page, so nothing in it can run even if sanitising missed it.
 */
export default function SvgRenderer({ source, bytes }: RendererProps) {
  const blob = useMemo(() => {
    if (!bytes) return null;
    const clean = sanitizeSvg(decodeText(bytes));
    if (!/<svg[\s>]/i.test(clean)) return null;
    return new Blob([clean], { type: "image/svg+xml" });
  }, [bytes]);
  const url = useObjectUrl(blob);
  if (!blob) return <ErrorState name={source.name} size={source.size} />;
  if (!url) return null;
  return <ImageView src={url} name={source.name} />;
}
