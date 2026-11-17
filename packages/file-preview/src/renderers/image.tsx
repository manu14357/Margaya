import { ImageView } from "../components/image-view";
import { ErrorState } from "../components/ui";
import type { RendererProps } from "../types";

/** Photos and pictures, shown from their URL. */
export default function ImageRenderer({ source, url }: RendererProps) {
  if (!url) return <ErrorState name={source.name} size={source.size} />;
  return <ImageView src={url} name={source.name} />;
}
