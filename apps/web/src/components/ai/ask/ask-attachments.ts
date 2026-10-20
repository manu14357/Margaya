import type { AskAttachment } from "./use-ask-session";

// What Ask accepts as attachments (the API checks the same): up to three
// files of at most 5 MB together, images or plain text.

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
};

export const ATTACHMENT_TYPES: readonly string[] = [
  ...new Set(Object.values(TYPES_BY_EXTENSION)),
];

/** The file input's `accept`: the types and their extensions. */
export const ATTACHMENT_ACCEPT = [
  ...ATTACHMENT_TYPES,
  ...Object.keys(TYPES_BY_EXTENSION).map((extension) => `.${extension}`),
].join(",");

/** A file's media type as Ask sends it, or null when Ask can't take it. */
export function attachmentType(file: { name: string; type: string }) {
  const type = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ATTACHMENT_TYPES.includes(type)) return type;
  // Browsers often leave Markdown and CSV untyped.
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES_BY_EXTENSION[extension] ?? null;
}

export type AttachmentProblem = "type" | "size" | "count";

/**
 * Why `file` can't be attached next to the files already attached
 * (`count` of them, `bytes` in all), or null when it can.
 */
export function attachmentProblem(
  file: { name: string; type: string; size: number },
  current: { count: number; bytes: number },
): AttachmentProblem | null {
  if (current.count >= MAX_ATTACHMENTS) return "count";
  if (!attachmentType(file)) return "type";
  if (current.bytes + file.size > MAX_ATTACHMENT_BYTES) return "size";
  return null;
}

/** Reads a file as Ask sends it (base64, without the data URL prefix). */
export function readAttachment(file: File): Promise<AskAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve({
        name: file.name,
        mediaType: attachmentType(file) ?? file.type,
        data: comma >= 0 ? result.slice(comma + 1) : result,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}
