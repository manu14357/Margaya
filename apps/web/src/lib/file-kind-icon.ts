import type { LucideIcon } from "lucide-react";
import { File, FileArchive, FileText } from "lucide-react";

const ARCHIVE_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-7z-compressed",
]);

const TEXT_TYPES = new Set([
  "application/pdf",
  "application/json",
  "application/xml",
  "application/rtf",
]);

/**
 * What an attachment row shows on its left: "image" for a thumbnail,
 * otherwise the icon for its content type.
 */
export function fileKindIcon(
  mimeType: string,
  kind?: "image" | "attachment",
): LucideIcon | "image" {
  if (kind === "image") return "image";
  const type = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (ARCHIVE_TYPES.has(type)) return FileArchive;
  if (type.startsWith("text/") || TEXT_TYPES.has(type)) return FileText;
  return File;
}
