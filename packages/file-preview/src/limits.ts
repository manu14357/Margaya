import type { FileKind } from "./detect";

const KB = 1024;
const MB = 1024 * KB;

export type PreviewLimit = {
  /** Bytes the preview reads at most. */
  maxBytes: number;
  /**
   * Text-like kinds show the first `maxBytes` with a notice instead of
   * refusing the file.
   */
  truncate?: boolean;
};

// How much of a file each renderer is trusted with. Beyond these the
// preview shows the file card with Download: parsing a 500 MB workbook in a
// browser tab freezes it, and none of these views stream.
export const PREVIEW_LIMITS: Record<FileKind, PreviewLimit> = {
  pdf: { maxBytes: 150 * MB },
  word: { maxBytes: 30 * MB },
  spreadsheet: { maxBytes: 40 * MB },
  csv: { maxBytes: 20 * MB, truncate: true },
  presentation: { maxBytes: 80 * MB },
  image: { maxBytes: 60 * MB },
  svg: { maxBytes: 5 * MB },
  markdown: { maxBytes: 4 * MB, truncate: true },
  text: { maxBytes: 4 * MB, truncate: true },
  code: { maxBytes: 4 * MB, truncate: true },
  html: { maxBytes: 4 * MB, truncate: true },
  // Played from the URL, streamed by the browser: no read limit.
  video: { maxBytes: Number.POSITIVE_INFINITY },
  audio: { maxBytes: Number.POSITIVE_INFINITY },
  archive: { maxBytes: 250 * MB },
  model3d: { maxBytes: 120 * MB },
  unknown: { maxBytes: 0 },
};

/** Code above this is shown as plain text: highlighting it would stall. */
export const HIGHLIGHT_LIMIT = { bytes: 400 * KB, lines: 12_000 };

/** Spreadsheet rows parsed per sheet; more are left out with a notice. */
export const SHEET_ROW_LIMIT = 100_000;

export const ZIP_LIMITS = {
  /** Archives listing more entries than this are refused. */
  maxEntries: 10_000,
  /** One entry may expand to at most this many bytes. */
  maxEntryBytes: 120 * MB,
  /** Bytes extracted from one archive over a whole preview session. */
  maxTotalBytes: 512 * MB,
  /** Expansion ratio above which a large entry counts as a zip bomb. */
  maxRatio: 200,
  /** The ratio check only applies above this size. */
  ratioFloor: 4 * MB,
  /** Archives inside archives open this many levels deep. */
  maxDepth: 3,
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < KB) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / KB;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
