import type { DetectedFile } from "./detect";

/**
 * A file to preview. `load` wins over `url`: hosts with their own transport
 * (an archive entry, a desktop file handle) hand the bytes over directly.
 * Keep the object stable between renders; the preview reloads when `url`,
 * `name`, `size` or `mimeType` change.
 */
export type PreviewSource = {
  name: string;
  mimeType?: string;
  size?: number;
  url?: string;
  /** Sent with `fetch(url)`; default "same-origin". */
  credentials?: RequestCredentials;
  load?: (signal: AbortSignal) => Promise<Blob | ArrayBuffer>;
};

/** What a renderer receives once its file is ready. */
export type RendererProps = {
  source: PreviewSource;
  file: DetectedFile;
  /** Playable or displayable address: image, video and audio kinds. */
  url?: string;
  /** The file's bytes: every other kind. */
  bytes?: Uint8Array;
  /** Only the first part of the file was read. */
  truncated: boolean;
};
