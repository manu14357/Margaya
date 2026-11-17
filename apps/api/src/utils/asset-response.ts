// How GET /api/asset/{id} answers for a stored content type: which files a
// browser may show (inline) and with what type, and which only download.
// Uploaded HTML, SVG, XML and scripts always download as
// application/octet-stream, so no uploaded file can run as a page or a
// script on the API's origin.

const INLINE_IMAGE_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const INLINE_MEDIA_TYPES = new Set([
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-wav",
  "video/mp4",
  "video/ogg",
  "video/quicktime",
  "video/webm",
]);

// Shown as plain text, whatever their stored type: text/plain cannot run,
// and with nosniff it is refused as a script or style sheet.
const PLAIN_TEXT_TYPES = new Set([
  "application/json",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/x-log",
  "text/x-markdown",
]);

export const PDF_TYPE = "application/pdf";

export type AssetResponseType = {
  inline: boolean;
  contentType: string;
};

/** `storedType`: the object's (or the row's) type, lower-cased, no parameters. */
export function assetResponseType(
  storedType: string,
  forceDownload: boolean,
): AssetResponseType {
  if (!forceDownload) {
    if (
      INLINE_IMAGE_TYPES.has(storedType) ||
      INLINE_MEDIA_TYPES.has(storedType) ||
      storedType === PDF_TYPE
    ) {
      return { inline: true, contentType: storedType };
    }
    if (PLAIN_TEXT_TYPES.has(storedType)) {
      return { inline: true, contentType: "text/plain; charset=utf-8" };
    }
  }
  return { inline: false, contentType: "application/octet-stream" };
}

function webOrigins(): string[] {
  const configured = [process.env.MARGAYA_CLIENT_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .join(",");
  const origins = new Set<string>();
  for (const raw of configured.split(",")) {
    try {
      const url = new URL(raw.trim());
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.add(url.origin);
      }
    } catch {
      // Not a URL: never part of a header.
    }
  }
  return [...origins];
}

/**
 * The policy of an inline PDF: no content of its own (the browser's viewer
 * draws it), framed only by this server and its web app, so the app's file
 * preview can embed it. Every other API response forbids framing
 * (security-headers.ts).
 */
export function pdfPreviewPolicy(): string {
  const ancestors = ["'self'", ...webOrigins()].join(" ");
  return `default-src 'none'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;
}
