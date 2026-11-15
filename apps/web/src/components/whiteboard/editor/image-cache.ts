// Board images, loaded once per asset id and shared by every frame. The
// renderer asks synchronously; a missing image starts loading and the board
// repaints when it arrives. Display images load without CORS (an <img> sends
// the session cookie); export re-fetches them as blobs so the canvas stays
// clean (see export.ts).

export type ImageCache = {
  get(assetId: string): HTMLImageElement | null;
  /** Resolves once the image is loaded (or failed), for export. */
  load(assetId: string): Promise<HTMLImageElement | null>;
  dispose(): void;
};

type Entry = {
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
  promise: Promise<HTMLImageElement | null>;
};

export function createImageCache(
  urlOf: (assetId: string) => string,
  onLoad: () => void,
): ImageCache {
  const entries = new Map<string, Entry>();
  let disposed = false;

  const start = (assetId: string): Entry => {
    const existing = entries.get(assetId);
    if (existing) return existing;
    const image = new Image();
    image.decoding = "async";
    const entry = { image, ready: false, failed: false } as Entry;
    entry.promise = new Promise((resolve) => {
      image.onload = () => {
        entry.ready = true;
        if (!disposed) onLoad();
        resolve(image);
      };
      image.onerror = () => {
        entry.failed = true;
        resolve(null);
      };
    });
    image.src = urlOf(assetId);
    entries.set(assetId, entry);
    return entry;
  };

  return {
    get(assetId) {
      if (typeof Image === "undefined") return null;
      const entry = start(assetId);
      return entry.ready ? entry.image : null;
    },
    load(assetId) {
      if (typeof Image === "undefined") return Promise.resolve(null);
      return start(assetId).promise;
    },
    dispose() {
      disposed = true;
      entries.clear();
    },
  };
}
