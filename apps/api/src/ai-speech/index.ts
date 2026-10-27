import { requireAiEnabled, requireAiUse } from "../ai/access";
import { isPrivateHost } from "../ai/embedding-endpoint";
import { AiError } from "../ai/errors";
import {
  type AiInstanceConfig,
  getAiInstanceConfig,
  speechConfigured,
} from "../ai/instance-config";
import { aiErrorResponse } from "../ai/sse";
import { emptyUsage } from "../ai/types";
import {
  assertWithinBudget,
  recordAiUsage,
  type UsageStatus,
} from "../ai/usage";
import type { WorkspaceAiPolicy } from "../ai/workspace-settings";
import { loadWorkspaceAi } from "../ai/workspace-settings";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { assertPublicDestination } from "../utils/assert-public-destination";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { createRateLimiter, enforceRateLimits } from "../utils/rate-limit";
import { workspaceAccess } from "../utils/workspace-access-middleware";

// Server speech-to-text for the chat composer: the recording goes to the
// instance's OpenAI-compatible transcription endpoint (ai.speech.*, e.g. a
// local Whisper server) and only the text comes back, to be edited before
// sending. Audio and text are never stored; the ledger records the call
// (feature "speech") without content. Like embeddings, an endpoint on the
// operator's network counts as local and any other as cloud, so local-only
// workspaces never send audio to a cloud endpoint.

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_TEXT_CHARS = 20_000;

const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/flac",
  "video/webm",
]);

const limiter = createRateLimiter({
  name: "ai-speech",
  windowSeconds: 60,
  max: 20,
});

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/** Replaces the HTTP client (tests); null restores fetch. */
export function setSpeechFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? ((...args) => fetch(...args));
}

/**
 * Whether audio of this workspace may go to the speech endpoint. Only
 * "Local only" (instance or workspace) keeps recordings off a cloud
 * endpoint: the private-data route chooses which model reads workspace
 * data, while the speech endpoint is a separate service the admin chose for
 * voice, so a local model and cloud speech can be combined.
 */
export async function speechDestinationAllowed(
  instance: AiInstanceConfig,
  policy: Pick<WorkspaceAiPolicy, "localOnly">,
): Promise<{ ok: boolean; local: boolean }> {
  const local = await isPrivateHost(new URL(instance.speech.baseUrl).hostname);
  return { ok: local || !(instance.localOnly || policy.localOnly), local };
}

/**
 * Where audio is posted: <url>/audio/transcriptions for OpenAI-compatible
 * endpoints, Fish Audio's ASR URL exactly as given.
 */
export function speechUrl(instance: AiInstanceConfig): string {
  const base = instance.speech.baseUrl.replace(/\/+$/, "");
  return instance.speech.format === "fish"
    ? base
    : `${base}/audio/transcriptions`;
}

/**
 * Posts one recording to the speech endpoint and returns its text. Errors
 * are curated AiErrors; `detail` adds the URL to them (for admins testing
 * the endpoint, never for people dictating).
 */
async function callSpeechEndpoint(
  instance: AiInstanceConfig,
  audio: File,
  options: { language?: string; signal?: AbortSignal; detail?: boolean },
): Promise<string> {
  const url = speechUrl(instance);
  const where = options.detail ? ` (${url})` : "";
  const local = await isPrivateHost(new URL(url).hostname);
  if (!local) {
    try {
      await assertPublicDestination(url, "Speech endpoint");
    } catch {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        "The speech endpoint must be a public address",
      );
    }
  }
  const fish = instance.speech.format === "fish";
  const form = new FormData();
  // Fish Audio: the file is "audio" and there is no model or format field.
  form.set(fish ? "audio" : "file", audio, audio.name || "recording.webm");
  if (fish) {
    form.set("ignore_timestamps", "true");
  } else {
    form.set("model", instance.speech.model);
    form.set("response_format", "json");
  }
  if (options.language) form.set("language", options.language.toLowerCase());

  const headers: Record<string, string> = {};
  if (instance.speech.apiKey) {
    headers.authorization = `Bearer ${instance.speech.apiKey}`;
  }
  // Fish Audio picks its model (transcribe-1-pro, transcribe-1) from a
  // header; a form field would be ignored.
  if (fish && instance.speech.model) headers.model = instance.speech.model;
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: form,
    signal: options.signal
      ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), options.signal])
      : AbortSignal.timeout(TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) {
    // The service's own reason ({"message": "..."}), for admins testing only.
    const raw = await response.text().catch(() => "");
    let reason = "";
    if (options.detail) {
      try {
        const message = (JSON.parse(raw) as { message?: unknown }).message;
        if (typeof message === "string") reason = ` ${message.slice(0, 200)}`;
      } catch {
        // Not JSON: no reason to show.
      }
    }
    if (response.status === 401 || response.status === 403) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        `The speech endpoint rejected the API key${where}.${reason}`,
      );
    }
    if (response.status === 402) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        `The speech service account has no credit left (402)${where}. Add API credit with the provider, then test again.${reason}`,
      );
    }
    if (response.status === 429) {
      throw new AiError(
        "AI_RATE_LIMITED",
        `The speech service is at its limit for now (429)${where}. Try again in a moment.${reason}`,
      );
    }
    if (response.status === 404 || response.status === 405) {
      throw new AiError(
        "AI_NOT_CONFIGURED",
        fish
          ? `The speech endpoint was not found${where}. For Fish Audio use https://api.fish.audio/v1/asr.`
          : `The speech endpoint or model was not found${where}. Margaya posts to <endpoint>/audio/transcriptions, so the endpoint must be OpenAI-compatible; for Fish Audio choose that API format.`,
      );
    }
    throw new AiError(
      "AI_PROVIDER_ERROR",
      `The speech endpoint failed (${response.status})${where}.${reason}`,
    );
  }
  let body: { text?: unknown };
  try {
    body = (await response.json()) as { text?: unknown };
  } catch {
    throw new AiError(
      "AI_PROVIDER_ERROR",
      `The speech endpoint did not answer with JSON${where}`,
    );
  }
  return typeof body.text === "string"
    ? body.text.trim().slice(0, MAX_TEXT_CHARS)
    : "";
}

/** One second of 16 kHz mono silence as a WAV file: a tiny test upload. */
function silentWav(): File {
  const samples = 16_000;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return new File([buffer], "test.wav", { type: "audio/wav" });
}

/**
 * The instance speech test: one second of silence to the saved endpoint.
 * Silence may come back as empty text; any well-formed answer passes.
 */
export async function testSpeechEndpoint(instance: AiInstanceConfig) {
  const result = {
    provider: speechConfigured(instance)
      ? instance.speech.format === "fish"
        ? "fish_audio"
        : "openai_compatible"
      : null,
    model: instance.speech.model || null,
    destination: null as "cloud" | "local" | null,
  };
  if (!speechConfigured(instance)) {
    return {
      ...result,
      ok: false,
      code: "AI_NOT_CONFIGURED",
      message:
        instance.speech.format === "fish"
          ? "Set the endpoint URL first"
          : "Set the endpoint URL and model first",
      latencyMs: null,
    };
  }
  result.destination = (await isPrivateHost(
    new URL(instance.speech.baseUrl).hostname,
  ))
    ? "local"
    : "cloud";
  const startedAt = performance.now();
  try {
    await callSpeechEndpoint(instance, silentWav(), { detail: true });
    return {
      ...result,
      ok: true,
      code: null,
      // It answers, but with "Local only" no workspace may send it audio.
      message:
        result.destination === "cloud" && instance.localOnly
          ? "Local-only mode is on, so workspaces won't send recordings to this cloud endpoint. Use a speech endpoint on your own network, or turn Local-only mode off (private data can still go to the local model)."
          : null,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ...result,
      ok: false,
      code: error instanceof AiError ? error.code : "AI_PROVIDER_ERROR",
      message:
        error instanceof AiError
          ? error.message
          : `The speech endpoint could not be reached (${speechUrl(instance)})`,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

function baseType(type: string): string {
  return type.split(";")[0]?.trim().toLowerCase() ?? "";
}

const transcribeRoute = createRoute({
  method: "post",
  operationId: "transcribeSpeech",
  path: "/transcribe",
  tags: ["AI"],
  summary: "Transcribe speech",
  description:
    "Turn a short recording (multipart field `audio`: WebM, Ogg, MP3, MP4/M4A, WAV or FLAC, at most 10 MB) into text with the instance's speech-to-text endpoint, for the person to edit before sending. Nothing is stored; the call counts in AI usage as feature `speech`. Optional `language` (ISO 639-1, e.g. de) hints the spoken language. Needs ai:use and AI on for the instance and the workspace; 409 AI_NOT_CONFIGURED when no speech endpoint is set up, 403 AI_ROUTE_BLOCKED when the workspace's data may only go to local models and the endpoint is not local.",
  middleware: [
    boundedRequestBody(MAX_AUDIO_BYTES + 64 * 1024, 30_000),
    workspaceAccess.fromQuery(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: {
    query: z.object({
      workspaceId: z.string().min(1),
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/i)
        .optional(),
    }),
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z
            .object({
              audio: z.any().openapi({ type: "string", format: "binary" }),
            })
            .openapi("SpeechUpload"),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The transcript",
      z.object({ text: z.string() }).openapi("SpeechTranscript"),
    ),
    400: errorResponse("No audio file, or not an accepted audio type"),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED) or audio may not go to this endpoint (AI_ROUTE_BLOCKED); or a plain-text error: no workspace access or missing ai:use",
    ),
    409: aiErrorResponse("No speech endpoint is set up (AI_NOT_CONFIGURED)"),
    413: errorResponse("The recording is larger than 10 MB"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
    502: aiErrorResponse("The speech endpoint failed (AI_PROVIDER_ERROR)"),
  },
});

const aiSpeech = apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  transcribeRoute,
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const { language } = c.req.valid("query");
    const instance = getAiInstanceConfig();
    if (!speechConfigured(instance)) {
      throw new AiError("AI_NOT_CONFIGURED", "No speech endpoint is set up");
    }
    const audio = c.req.valid("form").audio as unknown;
    if (!(audio instanceof File) || audio.size === 0) {
      return c.text("audio: a recording is required", 400);
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return c.text("The recording is larger than 10 MB", 413);
    }
    const type = baseType(audio.type);
    if (!AUDIO_TYPES.has(type)) {
      return c.text("audio: not an accepted audio type", 400);
    }
    const { policy } = await loadWorkspaceAi(workspaceId);
    const destination = await speechDestinationAllowed(instance, policy);
    if (!destination.ok) {
      throw new AiError(
        "AI_ROUTE_BLOCKED",
        "This workspace's data may only go to a local model, and the speech endpoint is not local",
      );
    }
    await assertWithinBudget({ workspaceId, userId, policy });
    await enforceRateLimits([[limiter, userId]]);

    const startedAt = performance.now();
    let status: UsageStatus = "error";
    let text = "";
    try {
      text = await callSpeechEndpoint(instance, audio, {
        language,
        signal: c.req.raw.signal,
      });
      status = "ok";
    } catch (error) {
      if (c.req.raw.signal.aborted) status = "cancelled";
      if (error instanceof AiError) throw error;
      // The kind only: never the audio, the text or the endpoint's answer.
      console.error("Speech transcription failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
      throw new AiError("AI_PROVIDER_ERROR", "The speech endpoint failed");
    } finally {
      try {
        await recordAiUsage({
          workspaceId,
          userId,
          feature: "speech",
          provider: "openai_compatible",
          model: instance.speech.model,
          tier: "fast",
          dataTier: "private",
          status,
          // Transcription endpoints report no tokens: the text length stands in.
          usage: { ...emptyUsage(), output: Math.ceil(text.length / 4) },
          costMicros: 0,
          durationMs: performance.now() - startedAt,
        });
      } catch (error) {
        console.error("Couldn't record AI usage", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return c.json({ text }, 200);
  },
);

export default aiSpeech;
