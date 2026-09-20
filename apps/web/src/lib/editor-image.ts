// Image helpers shared by the editors: the preview event a node view sends,
// and downloads.

export const IMAGE_PREVIEW_EVENT = "margaya-image-preview";

export type ImagePreview = { src: string; alt: string };

/** Asks the editor around `element` to open its full-screen preview. */
export function requestImagePreview(element: Element, preview: ImagePreview) {
  element.dispatchEvent(
    new CustomEvent<ImagePreview>(IMAGE_PREVIEW_EVENT, {
      bubbles: true,
      detail: preview,
    }),
  );
}

/**
 * The URL that downloads the image: Margaya's own assets take `download=1`
 * (an attachment response, sent with the session cookie like any link);
 * any other URL is used as is.
 */
export function imageDownloadUrl(src: string): string {
  try {
    const url = new URL(src, window.location.href);
    if (/\/asset\/[^/]+\/?$/.test(url.pathname)) {
      url.searchParams.set("download", "1");
      return url.toString();
    }
  } catch {
    // Not a URL: hand it back unchanged.
  }
  return src;
}

/** A file name from the image URL, else from its alt text. */
export function imageFileName(src: string, alt?: string | null): string {
  try {
    const last = new URL(src, window.location.href).pathname
      .split("/")
      .filter(Boolean)
      .pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    // Fall back to the alt text.
  }
  const base = (alt ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .slice(0, 80);
  return base || "image";
}

/** Starts a download of the image (a new tab for hosts that refuse one). */
export function downloadImage(src: string, alt?: string | null) {
  const link = document.createElement("a");
  link.href = imageDownloadUrl(src);
  link.download = imageFileName(src, alt);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.append(link);
  link.click();
  link.remove();
}
