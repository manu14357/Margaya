// Public entry of the shared file preview package. Hosts (the web app and
// the desktop Files window) import only from here.

export {
  type DetectedFile,
  detectFileType,
  type FileKind,
  fileExtension,
} from "./detect";
export { FilePreview, type FilePreviewProps } from "./file-preview";
export * from "./file-type-icon";
export {
  DEFAULT_LABELS,
  type FilePreviewLabels,
  formatLabel,
  resolveLabels,
} from "./labels";
export {
  formatBytes,
  PREVIEW_LIMITS,
  type PreviewLimit,
  ZIP_LIMITS,
} from "./limits";
export {
  deliveryOf,
  getPreviewRenderer,
  type PreviewRendererEntry,
  PreviewRendererRegistry,
} from "./registry";
export type { PreviewSource, RendererProps } from "./types";
