import type { AiStreamHandlers, AiStreamMeta } from "@margaya/libs";
import { useCallback, useEffect, useRef, useState } from "react";
import { AI_ERROR_CODES, type AiErrorCode } from "@/lib/ai/format";

export type AiTextStreamStatus = "idle" | "streaming" | "done" | "error";

type Runner = (
  handlers: AiStreamHandlers & { signal: AbortSignal },
) => Promise<string>;

/**
 * One AI answer streamed as text: start it, watch it grow, stop it, or start
 * again. A newer start (or unmount) cancels the one before, so late deltas of
 * an old answer never land in a new one.
 */
export function useAiTextStream() {
  const [status, setStatus] = useState<AiTextStreamStatus>("idle");
  const [text, setText] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  /** The answering provider and model, for feedback and labels. */
  const [meta, setMeta] = useState<AiStreamMeta | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((current) => (current === "streaming" ? "done" : current));
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus("idle");
    setText("");
    setErrorKey(null);
    setMeta(null);
  }, []);

  const start = useCallback(async (run: Runner) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("streaming");
    setText("");
    setErrorKey(null);
    setMeta(null);
    const current = () => controllerRef.current === controller;
    let failed = false;
    try {
      await run({
        signal: controller.signal,
        onMeta: (next) => {
          if (current()) setMeta(next);
        },
        onDelta: (delta) => {
          if (current()) setText((previous) => previous + delta);
        },
        onError: (error) => {
          if (!current()) return;
          failed = true;
          const code = (AI_ERROR_CODES as readonly string[]).includes(
            error.code,
          )
            ? (error.code as AiErrorCode)
            : null;
          setErrorKey(code ? `ai:errors.${code}` : "ai:errors.unknown");
          setStatus("error");
        },
      });
      if (current() && !failed) setStatus("done");
    } catch {
      if (!current() || controller.signal.aborted) return;
      setErrorKey("ai:errors.unknown");
      setStatus("error");
    } finally {
      if (current()) controllerRef.current = null;
    }
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { status, text, setText, errorKey, meta, start, stop, reset };
}
