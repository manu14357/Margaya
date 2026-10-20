import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeSpeech } from "@/fetchers/ai/speech";

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
export type SpeechError = "denied" | "failed";

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
}) {
  const [state, setState] = useState<SpeechState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(input.onText);
  onTextRef.current = input.onText;
  const onErrorRef = useRef(input.onError);
  onErrorRef.current = input.onError;
  const useServer = input.server && canRecord();
  const Recognizer = useServer ? null : recognitionConstructor();
  const supported = useServer || Recognizer !== null;

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      stopTracks(recorder);
    },
    [],
  );

  const startServer = useCallback(async () => {
    const workspaceId = input.workspaceId;
    if (!workspaceId) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onErrorRef.current?.("denied");
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      stopTracks(recorder);
      recorderRef.current = null;
      const audio = new Blob(chunks, {
        type: recorder.mimeType || "audio/webm",
      });
      if (audio.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      const language = input.lang.split("-")[0]?.toLowerCase();
      transcribeSpeech({ workspaceId, audio, language })
        .then(({ text }) => {
          if (text.trim()) onTextRef.current(text.trim());
        })
        .catch(() => onErrorRef.current?.("failed"))
        .finally(() => setState("idle"));
    };
    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
  }, [input.workspaceId, input.lang]);

  const startBrowser = useCallback(() => {
    if (!Recognizer) return;
    const recognition = new Recognizer();
    recognition.lang = input.lang;
    recognition.continuous = true;
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
      if (text.trim()) onTextRef.current(text.trim());
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      onErrorRef.current?.(
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "denied"
          : "failed",
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setState("idle");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
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

  return { supported, state, toggle, stop };
}
