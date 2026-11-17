// Every string the preview shows. Hosts pass translated labels; anything
// missing falls back to these English defaults. `{name}` placeholders are
// filled in by the preview itself, so a host translates the template once
// (for example `t("…pageCount", { total: "{total}" })`).

export const DEFAULT_LABELS = {
  loading: "Loading preview…",
  errorTitle: "Couldn't show this file",
  errorBody:
    "It may be damaged or in a format the preview can't read. You can still download it.",
  noPreview: "This file can't be previewed. Download it to open it.",
  tooLarge: "This file is too large to preview here (limit {size}).",
  truncated: "Showing the first {size}. Download the file to see all of it.",
  download: "Download",
  openExternal: "Open",
  toolbar: "Preview tools",
  more: "More tools",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomReset: "Reset zoom",
  fitWidth: "Fit to width",
  fitPage: "Fit page",
  rotate: "Rotate",
  fullScreen: "Full screen",
  exitFullScreen: "Exit full screen",
  pageNumber: "Page number",
  pageCount: "of {total}",
  pageLabel: "Page {page}",
  thumbnails: "Thumbnails",
  passwordProtected:
    "This PDF is protected with a password. Download it to open it.",
  find: "Find",
  findPlaceholder: "Find…",
  findNext: "Next match",
  findPrevious: "Previous match",
  findCount: "{current} of {total}",
  findNone: "No matches",
  findClose: "Close find",
  sheets: "Sheets",
  rowsTruncated:
    "Showing the first {rows} rows. Download the file to see all of it.",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  slideCount: "Slide {current} of {total}",
  slideLabel: "Slide {number}",
  present: "Present",
  exitPresent: "Exit presentation",
  plainText:
    "This file is too large to highlight, so it's shown as plain text.",
  viewSource: "Source",
  viewRendered: "Preview",
  htmlNotice: "Shown without scripts, links or outside content.",
  archiveName: "Name",
  archiveSize: "Size",
  archiveModified: "Modified",
  archiveItems: "Items: {count}",
  archiveBack: "Back to the archive",
  archiveUp: "Up one folder",
  archiveRoot: "Archive",
  archiveTooMany:
    "This archive holds more than {count} items, too many to list.",
  archiveEntryTooLarge: "This item expands too much to preview safely.",
  archiveEncrypted: "This item is encrypted and can't be previewed.",
  archiveTooDeep: "Archives inside archives open up to {depth} levels deep.",
  wireframe: "Wireframe",
  resetView: "Reset view",
  modelHint: "Drag to rotate, scroll to zoom, right-drag to pan.",
} as const;

export type FilePreviewLabels = { [K in keyof typeof DEFAULT_LABELS]: string };

/** Defaults overlaid with whatever the host translated. */
export function resolveLabels(
  labels?: Partial<FilePreviewLabels> | null,
): FilePreviewLabels {
  if (!labels) return DEFAULT_LABELS;
  const merged: { -readonly [K in keyof FilePreviewLabels]: string } = {
    ...DEFAULT_LABELS,
  };
  for (const key of Object.keys(DEFAULT_LABELS) as Array<
    keyof FilePreviewLabels
  >) {
    const value = labels[key];
    if (typeof value === "string" && value.length > 0) merged[key] = value;
  }
  return merged;
}

/** Fills `{name}` placeholders; unknown ones stay as they are. */
export function formatLabel(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
