import { answerLocale } from "../ai-translate/schema";
import { z } from "../openapi";
import {
  CAPTURE_IMAGE_TYPES,
  MAX_CAPTURE_IMAGE_BASE64,
  MAX_CAPTURE_IMAGES,
  MAX_CAPTURE_TOTAL_BYTES,
} from "./images";

// Request schemas of the capture route (ai-capture/index.ts).

export const CAPTURE_SOURCES = [
  "screenshot",
  "recording",
  "transcript",
] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/** Characters of pasted notes or transcript. */
export const MAX_CAPTURE_TEXT = 60_000;

/** The JSON body bound: every image at its largest plus the text. */
export const MAX_CAPTURE_BODY_BYTES =
  Math.ceil(MAX_CAPTURE_TOTAL_BYTES / 3) * 4 + MAX_CAPTURE_TEXT * 4 + 64_000;

export const captureProjectParam = z.object({
  projectId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "projectId", in: "path" },
      description: "The project the requests are for",
    }),
});

const captureImage = z.strictObject({
  mediaType: z.enum(CAPTURE_IMAGE_TYPES).openapi({
    description:
      "The image type; the bytes must really be this type. Metadata (EXIF, XMP, IPTC, text chunks) is removed before the model sees it.",
  }),
  data: z.string().min(1).max(MAX_CAPTURE_IMAGE_BASE64).openapi({
    description:
      "Base64 of the image, at most 3.75 MB decoded. A data: URL prefix is allowed.",
  }),
});

export const captureBody = z
  .strictObject({
    source: z.enum(CAPTURE_SOURCES).openapi({
      description:
        "screenshot: one or more screenshots; recording: key frames taken from a screen recording (in order); transcript: meeting notes or a transcript, which may yield several requests.",
    }),
    images: z
      .array(captureImage)
      .max(MAX_CAPTURE_IMAGES)
      .default([])
      .openapi({
        description: `Up to ${MAX_CAPTURE_IMAGES} images, 9 MB together.`,
      }),
    text: z.string().max(MAX_CAPTURE_TEXT).optional().openapi({
      description:
        "The transcript or notes, or what the reporter adds to the images.",
    }),
    locale: answerLocale,
  })
  .refine((body) => body.images.length > 0 || Boolean(body.text?.trim()), {
    message: "Send at least one image or some text",
  })
  .openapi("AiCaptureInput");

export type CaptureBody = z.infer<typeof captureBody>;
