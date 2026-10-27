// Capture media in the browser. Every image is redrawn on a canvas and
// re-encoded, which drops EXIF, XMP and other metadata (the server strips it
// again) and scales large screenshots to what vision models read. Screen
// recordings never leave the browser: a few key frames are taken here and
// sent as images.

export const CAPTURE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const CAPTURE_IMAGE_ACCEPT = CAPTURE_IMAGE_TYPES.join(",");
/** Images per capture (the API allows 6). */
export const MAX_CAPTURE_IMAGES = 6;
/** The largest image file read; the encoded result is much smaller. */
export const MAX_SOURCE_IMAGE_BYTES = 25_000_000;
/** The largest recording read (locally only). */
export const MAX_RECORDING_BYTES = 1_000_000_000;
/** Key frames taken from a recording. */
export const RECORDING_FRAMES = 5;

const MAX_EDGE = 1600;
/** Keeps each encoded image well under the API's 3.75 MB. */
const MAX_ENCODED_BYTES = 3_000_000;

export type CaptureMediaErrorCode = "type" | "tooLarge" | "unreadable";

export class CaptureMediaError extends Error {
  constructor(public code: CaptureMediaErrorCode) {
    super(code);
    this.name = "CaptureMediaError";
  }
}

export type CaptureImage = {
  id: string;
  name: string;
  /** The re-encoded file, without metadata: sent to AI and attached. */
  file: File;
  mediaType: "image/png" | "image/jpeg";
  /** Base64 of `file`. */
  data: string;
  /** Object URL for the thumbnail; revoke with releaseCaptureImages. */
  url: string;
};

let nextId = 0;

/** Whether a picked or pasted file is an image capture accepts. */
export function isCaptureImageFile(file: { type: string }): boolean {
  return CAPTURE_IMAGE_TYPES.includes(file.type);
}

/** The image files in a paste or drop, if any. */
export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files ?? []).filter(isCaptureImageFile);
}

function scaled(width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function encode(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new CaptureMediaError("unreadable")),
      type,
      quality,
    );
  });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new CaptureMediaError("unreadable"));
    reader.readAsDataURL(blob);
  });
}

async function fromCanvas(
  canvas: HTMLCanvasElement,
  baseName: string,
  preferPng: boolean,
): Promise<CaptureImage> {
  let mediaType: "image/png" | "image/jpeg" = preferPng
    ? "image/png"
    : "image/jpeg";
  let blob = await encode(canvas, mediaType, preferPng ? undefined : 0.88);
  if (blob.size > MAX_ENCODED_BYTES) {
    // Busy screenshots can be large as PNG; JPEG keeps text readable.
    mediaType = "image/jpeg";
    blob = await encode(canvas, mediaType, 0.82);
  }
  if (blob.size > MAX_ENCODED_BYTES) throw new CaptureMediaError("tooLarge");
  const extension = mediaType === "image/png" ? "png" : "jpg";
  const name = `${baseName.replace(/\.[a-z0-9]+$/i, "") || "capture"}.${extension}`;
  const file = new File([blob], name, { type: mediaType });
  nextId += 1;
  return {
    id: `capture-${nextId}`,
    name,
    file,
    mediaType,
    data: await toBase64(blob),
    url: URL.createObjectURL(blob),
  };
}

function canvasFor(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new CaptureMediaError("unreadable");
  return { canvas, context };
}

/** A screenshot or photo, redrawn without metadata and scaled down. */
export async function prepareCaptureImage(
  file: File,
  index = 0,
): Promise<CaptureImage> {
  if (!isCaptureImageFile(file)) throw new CaptureMediaError("type");
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new CaptureMediaError("tooLarge");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CaptureMediaError("unreadable");
  }
  try {
    const size = scaled(bitmap.width, bitmap.height);
    const { canvas, context } = canvasFor(size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await fromCanvas(
      canvas,
      file.name || `screenshot-${index + 1}`,
      file.type !== "image/jpeg",
    );
  } finally {
    bitmap.close();
  }
}

function waitFor(
  video: HTMLVideoElement,
  event: "loadedmetadata" | "seeked" | "durationchange",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new CaptureMediaError("unreadable")),
      15_000,
    );
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      window.clearTimeout(timer);
      reject(new CaptureMediaError("unreadable"));
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
  });
}

/** Evenly spaced key frames of a screen recording, as JPEG images. */
export async function extractRecordingFrames(
  file: File,
  count = RECORDING_FRAMES,
): Promise<CaptureImage[]> {
  if (!file.type.startsWith("video/")) throw new CaptureMediaError("type");
  if (file.size > MAX_RECORDING_BYTES) throw new CaptureMediaError("tooLarge");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = waitFor(video, "loadedmetadata");
    video.src = url;
    await loaded;
    let duration = video.duration;
    if (!Number.isFinite(duration)) {
      // Browser recordings (WebM) often report no duration until the end.
      const known = waitFor(video, "durationchange");
      video.currentTime = Number.MAX_SAFE_INTEGER;
      await known;
      duration = video.duration;
    }
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) {
      throw new CaptureMediaError("unreadable");
    }
    const size = scaled(video.videoWidth, video.videoHeight);
    const { canvas, context } = canvasFor(size.width, size.height);
    const base = file.name.replace(/\.[a-z0-9]+$/i, "") || "recording";
    const frames: CaptureImage[] = [];
    for (let i = 0; i < count; i += 1) {
      const seeked = waitFor(video, "seeked");
      video.currentTime = Math.min(
        duration - 0.05,
        (duration * (i + 0.5)) / count,
      );
      await seeked;
      context.drawImage(video, 0, 0, size.width, size.height);
      frames.push(await fromCanvas(canvas, `${base}-frame-${i + 1}`, false));
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function releaseCaptureImages(images: readonly CaptureImage[]): void {
  for (const image of images) URL.revokeObjectURL(image.url);
}
