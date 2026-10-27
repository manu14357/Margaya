import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeSpeech } from "@/fetchers/ai/speech";
import { aiErrorCode } from "@/lib/ai/format";
import { createSilenceDetector } from "./voice-reply";

// Voice input for the composer: the instance's speech-to-text endpoint when
// it has one (recorded with MediaRecorder), else the browser's own speech
// recognition (Chrome, Edge, Safari). The transcript goes into the composer
// to edit; it is never sent on its own.

type RecognitionResult = { 0?: { transcript?: string }; isFinal?: boolean };
type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export type SpeechState = "idle" | "recording" | "transcribing";
export type SpeechError =
  | "denied"
  | "unavailable"
  | "failed"
  | "empty"
  | "blocked";

/** Why the browser refused the microphone (getUserMedia DOMException names). */
function micError(error: unknown): SpeechError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (
    name === "NotFoundError" ||
    name === "NotReadableError" ||
    name === "OverconstrainedError" ||
    name === "AbortError"
  ) {
    return "unavailable";
  }
  return "failed";
}

function stopTracks(recorder: MediaRecorder | null) {
  for (const track of recorder?.stream.getTracks() ?? []) track.stop();
}

/**
 * `supported` says whether to show the mic at all. `toggle` starts or
 * stops; each finished transcript goes to `onText`.
 */
export function useSpeechInput(input: {
  workspaceId: string | undefined;
  /** The instance transcribes (availability.features.speech). */
  server: boolean;
  /** BCP 47, the UI's language. */
  lang: string;
  onText: (text: string) => void;
  onError?: (error: SpeechError) => void;
  /**
   * Voice mode: stop by itself after speech and a pause, and give up (with
   * onNoSpeech) when nothing is said.
   */
  autoStop?: boolean;
  onNoSpeech?: () => void;
}) {
  const [state, setState] = useState<SpeechState>("idle");
  /** When recording started (for the elapsed time), null when idle. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** The microphone's loudness, 0 to 1, while recording to the server. */
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** true: thrown away; "silent": nothing was said (voice mode). */
  const discardRef = useRef<boolean | "silent">(false);
  const meterRef = useRef<{ context: AudioContext; frame: number } | null>(
    null,
  );
  const recognitionRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(input.onText);
  onTextRef.current = input.onText;
  const onErrorRef = useRef(input.onError);
  onErrorRef.current = input.onError;
  const onNoSpeechRef = useRef(input.onNoSpeech);
  onNoSpeechRef.current = input.onNoSpeech;
  const autoStopRef = useRef(input.autoStop === true);
  autoStopRef.current = input.autoStop === true;
  const useServer = input.server && canRecord();
  const Recognizer = useServer ? null : recognitionConstructor();
  const supported = useServer || Recognizer !== null;

  const stopMeter = useCallback(() => {
    const meter = meterRef.current;
    meterRef.current = null;
    if (meter) {
      cancelAnimationFrame(meter.frame);
      void meter.context.close().catch(() => {});
    }
    setLevel(0);
  }, []);

  /**
   * Samples the stream's loudness about twenty times a second for the level
   * bars, and with autoStop decides when the person has finished.
   */
  const startMeter = useCallback(
    (stream: MediaStream, onSilence: (event: "end" | "no-speech") => void) => {
      if (typeof AudioContext === "undefined") return;
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const detector = autoStopRef.current ? createSilenceDetector() : null;
      let last = 0;
      const tick = (now: number) => {
        if (!meterRef.current) return;
        if (now - last > 50) {
          last = now;
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          const rms = Math.sqrt(sum / samples.length);
          setLevel(Math.min(1, rms * 4));
          const event = detector?.update(rms, now) ?? null;
          if (event) {
            onSilence(event === "no-speech" ? "no-speech" : "end");
            return;
          }
        }
        meterRef.current.frame = requestAnimationFrame(tick);
      };
      meterRef.current = { context, frame: requestAnimationFrame(tick) };
    },
    [],
  );

  useEffect(
    () => () => {
      stopMeter();
      recognitionRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      stopTracks(recorder);
    },
    [stopMeter],
  );

  const startServer = useCallback(async () => {
    const workspaceId = input.workspaceId;
    if (!workspaceId) return;
    let stream: MediaStream;
    try {
      // The browser's echo cancellation keeps a spoken reply out of the
      // next recording as far as it can; headphones do the rest.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      onErrorRef.current?.(micError(error));
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stopTracks(recorder);
      stopMeter();
      setStartedAt(null);
      recorderRef.current = null;
      const audio = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      if (audio.size === 0 || discardRef.current) {
        const silent = discardRef.current === "silent";
        discardRef.current = false;
        setState("idle");
        if (silent) onNoSpeechRef.current?.();
        return;
      }
      setState("transcribing");
      const language = input.lang.split("-")[0]?.toLowerCase();
      transcribeSpeech({ workspaceId, audio, language })
        .then(({ text }) => {
          if (text.trim()) onTextRef.current(text.trim());
          else onErrorRef.current?.("empty");
        })
        .catch((error: unknown) =>
          // Local-only routing keeps recordings away from a cloud endpoint.
          onErrorRef.current?.(
            aiErrorCode(error) === "AI_ROUTE_BLOCKED" ? "blocked" : "failed",
          ),
        )
        .finally(() => setState("idle"));
    };
    recorderRef.current = recorder;
    discardRef.current = false;
    recorder.start();
    startMeter(stream, (event) => {
      if (recorder.state === "inactive") return;
      if (event === "no-speech") discardRef.current = "silent";
      recorder.stop();
    });
    setStartedAt(Date.now());
    setState("recording");
  }, [input.workspaceId, input.lang, startMeter, stopMeter]);

  const startBrowser = useCallback(() => {
    if (!Recognizer) return;
    const recognition = new Recognizer();
    recognition.lang = input.lang;
    // Voice mode takes one phrase; the browser ends it after a pause.
    recognition.continuous = !autoStopRef.current;
    let heard = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let text = "";
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        if (result?.isFinal !== false) text += result?.[0]?.transcript ?? "";
      }
      if (text.trim()) {
        heard = true;
        onTextRef.current(text.trim());
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      onErrorRef.current?.(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "denied"
          : event.error === "audio-capture"
            ? "unavailable"
            : "failed",
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setStartedAt(null);
      setState("idle");
      if (!heard && autoStopRef.current) onNoSpeechRef.current?.();
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setStartedAt(Date.now());
      setState("recording");
    } catch {
      recognitionRef.current = null;
      onErrorRef.current?.("failed");
    }
  }, [Recognizer, input.lang]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (state === "recording") {
      stop();
      return;
    }
    if (state !== "idle") return;
    if (useServer) void startServer();
    else startBrowser();
  }, [state, stop, useServer, startServer, startBrowser]);

  /** Stops without transcribing: the recording is thrown away. */
  const cancel = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      discardRef.current = true;
      recorder.stop();
    }
  }, []);

  /** Starts listening (voice mode); does nothing unless idle. */
  const start = useCallback(() => {
    if (state !== "idle") return;
    if (useServer) void startServer();
    else startBrowser();
  }, [state, useServer, startServer, startBrowser]);

  return { supported, state, startedAt, level, toggle, start, stop, cancel };
}
