import { requireAiEnabled, requireAiUse } from "../ai/access";
import { isPrivateHost } from "../ai/embedding-endpoint";
import { AiError } from "../ai/errors";
import {
  type AiInstanceConfig,
  getAiInstanceConfig,
  speechConfigured,
} from "../ai/instance-config";
import { allowedTarget } from "../ai/router";
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

/** Whether audio of this workspace may go to the speech endpoint. */
export async function speechDestinationAllowed(
  instance: AiInstanceConfig,
  policy: Pick<WorkspaceAiPolicy, "localOnly">,
): Promise<{ ok: boolean; local: boolean }> {
  const local = await isPrivateHost(new URL(instance.speech.baseUrl).hostname);
  const target = allowedTarget("private", instance, policy);
  return { ok: local || target === "cloud", local };
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

    const url = `${instance.speech.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
    if (!destination.local) {
      try {
        await assertPublicDestination(url, "Speech endpoint");
      } catch {
        throw new AiError(
          "AI_NOT_CONFIGURED",
          "The speech endpoint must be a public address",
        );
      }
    }
    const form = new FormData();
    form.set("file", audio, audio.name || "recording.webm");
    form.set("model", instance.speech.model);
    form.set("response_format", "json");
    if (language) form.set("language", language.toLowerCase());

    const startedAt = performance.now();
    let status: UsageStatus = "error";
    let text = "";
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: instance.speech.apiKey
          ? { authorization: `Bearer ${instance.speech.apiKey}` }
          : {},
        body: form,
        signal: AbortSignal.any([
          AbortSignal.timeout(TIMEOUT_MS),
          c.req.raw.signal,
        ]),
        redirect: "error",
      });
      if (!response.ok) {
        await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          throw new AiError(
            "AI_NOT_CONFIGURED",
            "The speech endpoint rejected the API key",
          );
        }
        if (response.status === 404) {
          throw new AiError(
            "AI_NOT_CONFIGURED",
            "The speech endpoint or model was not found",
          );
        }
        throw new AiError(
          "AI_PROVIDER_ERROR",
          `The speech endpoint failed (${response.status})`,
        );
      }
      const body = (await response.json()) as { text?: unknown };
      text =
        typeof body.text === "string"
          ? body.text.trim().slice(0, MAX_TEXT_CHARS)
          : "";
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
