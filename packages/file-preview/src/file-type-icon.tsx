// A recognisable icon for any file: one lucide glyph per kind on a neutral
// tile, plus the extension badge ("PDF", "DOCX"), so the type never rests on
// colour or on the glyph alone.

import type { LucideIcon } from "lucide-react";
import {
  File,
  FileArchive,
  FileAxis3d,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileSpreadsheet,
  FileText,
  FileType,
  Presentation,
} from "lucide-react";
import type { CSSProperties } from "react";
import { detectFileType, type FileKind, fileExtension } from "./detect";
import "./file-type-icon.css";

type FileLike = { name: string; mimeType?: string | null };

// Kinds the preview can't render but people still recognise: they only
// change the icon, never which renderer opens the file.
const ICON_EXTENSIONS: Record<string, FileKind> = {
  doc: "word",
  dot: "word",
  odt: "word",
  rtf: "word",
  pages: "word",
  ppt: "presentation",
  pps: "presentation",
  odp: "presentation",
  key: "presentation",
  numbers: "spreadsheet",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  zst: "archive",
  heic: "image",
  heif: "image",
  tif: "image",
  tiff: "image",
  mkv: "video",
  avi: "video",
  wmv: "video",
  wma: "audio",
  aiff: "audio",
  fbx: "model3d",
  "3mf": "model3d",
  ply: "model3d",
  usdz: "model3d",
};

const ICON_MIME: Array<[RegExp, FileKind]> = [
  [/^application\/(msword|vnd\.oasis\.opendocument\.text|rtf)$/, "word"],
  [
    /^application\/(vnd\.ms-powerpoint|vnd\.oasis\.opendocument\.presentation)/,
    "presentation",
  ],
  [
    /^application\/(x-)?(gzip|gtar|tar|rar|7z-compressed|bzip2|xz|zstd|vnd\.rar)$/,
    "archive",
  ],
];

/** The file's kind for its icon: the preview's kind, else a wider guess. */
export function fileKindOf(file: FileLike): FileKind {
  const detected = detectFileType(file);
  if (detected.kind !== "unknown") return detected.kind;
  const byExtension = ICON_EXTENSIONS[detected.extension];
  if (byExtension) return byExtension;
  const mime = (file.mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  for (const [pattern, kind] of ICON_MIME) {
    if (pattern.test(mime)) return kind;
  }
  return "unknown";
}

const ICONS: Record<FileKind, LucideIcon> = {
  pdf: FileText,
  word: FileType,
  spreadsheet: FileSpreadsheet,
  csv: FileSpreadsheet,
  presentation: Presentation,
  image: FileImage,
  svg: FileImage,
  markdown: FileText,
  text: FileText,
  code: FileCode,
  html: FileCode,
  video: FilePlay,
  audio: FileMusic,
  archive: FileArchive,
  model3d: FileAxis3d,
  unknown: File,
};

/** The glyph for a kind of file. */
export function fileKindIconComponent(kind: FileKind): LucideIcon {
  return ICONS[kind];
}

// A badge for a file with no short extension of its own (a long one, or a
// type known only from its MIME type). Format names read the same in every
// language; kinds without one show no badge.
const KIND_BADGES: Partial<Record<FileKind, string>> = {
  pdf: "PDF",
  word: "DOC",
  spreadsheet: "XLS",
  csv: "CSV",
  presentation: "PPT",
  svg: "SVG",
  markdown: "MD",
  html: "HTML",
  archive: "ZIP",
};

/**
 * The short type label people know a file by: its extension in capitals
 * ("PDF", "DOCX"), or the format's usual name, or "" when there is none.
 */
export function fileTypeLabel(file: FileLike): string {
  const extension = fileExtension(file.name);
  if (/^[a-z0-9]{1,4}$/.test(extension)) return extension.toUpperCase();
  return KIND_BADGES[fileKindOf(file)] ?? "";
}

/** Below this size a badge would be unreadable, so only the glyph shows. */
const BADGE_MIN_SIZE = 28;

export type FileTypeIconProps = FileLike & {
  /** Edge of the tile in CSS pixels. Default 32. */
  size?: number;
  className?: string;
  /**
   * An accessible name. Without one the icon is decorative: the file's
   * name and type are expected as text beside it.
   */
  title?: string;
};

export function FileTypeIcon({
  name,
  mimeType,
  size = 32,
  className,
  title,
}: FileTypeIconProps) {
  const kind = fileKindOf({ name, mimeType });
  const Icon = ICONS[kind];
  const badge = size >= BADGE_MIN_SIZE ? fileTypeLabel({ name, mimeType }) : "";
  const style = { "--mfp-type-size": `${size}px` } as CSSProperties;
  return (
    <span
      className={className ? `mfp-type-icon ${className}` : "mfp-type-icon"}
      style={style}
      data-kind={kind}
      data-badge={badge || undefined}
      {...(title
        ? { role: "img", "aria-label": title, title }
        : { "aria-hidden": true })}
    >
      <Icon className="mfp-type-icon-glyph" aria-hidden="true" />
      {badge && <span className="mfp-type-icon-badge">{badge}</span>}
    </span>
  );
}
