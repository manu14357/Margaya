import { client } from "@margaya/libs";
import { HttpError } from "@/lib/http-error";

// Speech to text through the instance's speech endpoint (only when the
// instance has one: availability.features.speech).

export async function transcribeSpeech(input: {
  workspaceId: string;
  audio: Blob;
  /** ISO 639-1 hint for the spoken language, e.g. "de". */
  language?: string;
}): Promise<{ text: string }> {
  const type = input.audio.type || "audio/webm";
  const extension = type.includes("ogg")
    ? "ogg"
    : type.includes("mp4")
      ? "m4a"
      : "webm";
  const file = new File([input.audio], `speech.${extension}`, { type });
  const response = await client.ai.speech.transcribe.$post({
    query: {
      workspaceId: input.workspaceId,
      ...(input.language ? { language: input.language } : {}),
    },
    form: { audio: file },
  });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json();
}
