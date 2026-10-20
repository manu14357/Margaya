import { HTTPException } from "hono/http-exception";
import type { ChatContent } from "../ai/types";
import {
  InvalidCaptureImageError,
  sniffImageType,
  stripImageMetadata,
} from "../ai-capture/images";

// Files attached to an Ask question: images go to the model as image content
// (PNG, JPEG and WebP stripped of metadata such as EXIF and GPS, as in
// capture; GIF as sent), text files become context blocks. Nothing is stored.
// Images are at least private data for the Model Router; a model without
// vision fails like any provider error.

export const MAX_ASK_ATTACHMENTS = 3;
/** Decoded bytes of all attachments together. */
export const MAX_ASK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** Characters of one text file that reach the prompt. */
export const MAX_ATTACHMENT_TEXT_CHARS = 30_000;

export const ASK_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const ASK_TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;
export const ASK_ATTACHMENT_TYPES = [...ASK_IMAGE_TYPES, ...ASK_TEXT_TYPES];

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type AskAttachmentInput = {
  name: string;
  mediaType: string;
  data: string;
};

export type PreparedAttachments = {
  images: Extract<ChatContent, { type: "image" }>[];
  texts: { name: string; mediaType: string; text: string }[];
};

function isGif(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  return head === "GIF87a" || head === "GIF89a";
}

/**
 * Decodes and checks the attachments: types by their bytes (an image must be
 * the image it claims), text as valid UTF-8, and the size budget. 400 for a
 * bad file, 413 for too many or too large.
 */
export function prepareAskAttachments(
  attachments: readonly AskAttachmentInput[],
): PreparedAttachments {
  if (attachments.length > MAX_ASK_ATTACHMENTS) {
    throw new HTTPException(413, {
      message: `At most ${MAX_ASK_ATTACHMENTS} attachments per question`,
    });
  }
  const prepared: PreparedAttachments = { images: [], texts: [] };
  let total = 0;
  for (const [index, attachment] of attachments.entries()) {
    const label = `Attachment ${index + 1}`;
    const declared = attachment.mediaType.toLowerCase().split(";")[0]?.trim();
    const data = attachment.data
      .replace(/^data:[^,]*,/, "")
      .replace(/\s+/g, "");
    if (!data || !BASE64.test(data)) {
      throw new HTTPException(400, { message: `${label} is not valid base64` });
    }
    const bytes = new Uint8Array(Buffer.from(data, "base64"));
    total += bytes.length;
    if (total > MAX_ASK_ATTACHMENT_BYTES) {
      throw new HTTPException(413, {
        message: "The attachments are larger than 5 MB together",
      });
    }
    if (declared === "image/gif") {
      if (!isGif(bytes)) {
        throw new HTTPException(400, {
          message: `${label} is not a GIF image`,
        });
      }
      prepared.images.push({ type: "image", mediaType: "image/gif", data });
      continue;
    }
    if (declared?.startsWith("image/")) {
      const actual = sniffImageType(bytes);
      if (!actual || actual !== declared) {
        throw new HTTPException(400, {
          message: `${label}: only PNG, JPEG, WebP and GIF images are accepted`,
        });
      }
      let stripped: Uint8Array;
      try {
        stripped = stripImageMetadata(bytes, actual);
      } catch (error) {
        if (error instanceof InvalidCaptureImageError) {
          throw new HTTPException(400, {
            message: `${label} could not be read`,
          });
        }
        throw error;
      }
      prepared.images.push({
        type: "image",
        mediaType: actual,
        data: Buffer.from(stripped).toString("base64"),
      });
      continue;
    }
    if (!(ASK_TEXT_TYPES as readonly string[]).includes(declared ?? "")) {
      throw new HTTPException(400, {
        message: `${label}: only images (PNG, JPEG, WebP, GIF) and text, Markdown or CSV files are accepted`,
      });
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new HTTPException(400, { message: `${label} is not UTF-8 text` });
    }
    prepared.texts.push({
      name: attachment.name,
      mediaType: declared ?? "text/plain",
      text: text.replace(/^﻿/, ""),
    });
  }
  return prepared;
}
