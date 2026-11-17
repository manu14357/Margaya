import { useState } from "react";
import { ErrorState, Toolbar } from "../components/ui";
import type { RendererProps } from "../types";

/** Video and audio in the browser's own players. */
export default function MediaRenderer({ source, file, url }: RendererProps) {
  const [failed, setFailed] = useState(false);
  if (!url || failed)
    return <ErrorState name={source.name} size={source.size} />;
  return (
    <>
      <Toolbar />
      <div className="mfp-media">
        {file.kind === "audio" ? (
          // biome-ignore lint/a11y/useMediaCaption: people's own files carry no caption track
          <audio
            controls
            preload="metadata"
            src={url}
            aria-label={source.name}
            className="mfp-audio"
            onError={() => setFailed(true)}
          />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: people's own files carry no caption track
          <video
            controls
            preload="metadata"
            playsInline
            src={url}
            aria-label={source.name}
            className="mfp-video"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </>
  );
}
