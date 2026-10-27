import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { willApply } from "@/components/ai/build/build-turn";
import type { BuildTurn } from "@/components/ai/build/use-build-session";
import type { AskTurn } from "./use-ask-session";
import { useSpeaker } from "./use-speaker";
import { type SpeechError, useSpeechInput } from "./use-speech-input";
import { confirmIntent, speakableText } from "./voice-reply";

// Voice mode: speak a request, it is sent by itself, the answer is read
// aloud, and (optionally) it listens again. In Build mode a proposal is read
// out and waits for "confirm" or "cancel"; destructive changes still need a
// click on their card. Half duplex: it never listens while it speaks.

export type VoicePhase =
  | "off"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "confirming";

export type VoicePrefs = { speakReplies: boolean; keepListening: boolean };

const PREFS_KEY = "margaya.ask.voiceMode";
const DEFAULT_PREFS: VoicePrefs = { speakReplies: true, keepListening: false };
/** A breath between speaking and listening, so the reply's tail isn't recorded. */
const LISTEN_DELAY_MS = 300;

function readPrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

type Pending =
  | { kind: "ask"; index: number }
  | { kind: "build"; index: number }
  | { kind: "confirm"; turnId: string }
  | { kind: "apply"; turnId: string };

export function useVoiceMode(input: {
  workspaceId: string | undefined;
  /** The instance transcribes (availability.features.speech). */
  server: boolean;
  lang: string;
  mode: "ask" | "build" | "autopilot";
  askTurns: readonly AskTurn[];
  buildTurns: readonly BuildTurn[];
  /** Sends a request exactly as the Send button does. */
  send: (text: string) => void;
  applyBuild: (turnId: string) => void;
  cancelBuild: (turnId: string) => void;
  onError: (error: SpeechError) => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [prefs, setPrefsState] = useState<VoicePrefs>(readPrefs);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const pendingRef = useRef<Pending | null>(null);
  const spokenRef = useRef<string | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  // The callbacks are stable; the hook's returned object is not, and a
  // cleanup keyed on it would cancel every reply as soon as it starts.
  const { speak, cancel: hush, prime } = useSpeaker(input.lang);

  const end = useCallback(() => {
    pendingRef.current = null;
    setPhase("off");
  }, []);

  const speech = useSpeechInput({
    workspaceId: input.workspaceId,
    server: input.server,
    lang: input.lang,
    autoStop: true,
    onText: (text) => onTextRef.current(text),
    onError: (error) => {
      end();
      inputRef.current.onError(error);
    },
    // Nothing said: voice mode ends quietly; a proposal stays on screen.
    onNoSpeech: end,
  });
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const listen = useCallback((next: "listening" | "confirming") => {
    setPhase(next);
    window.setTimeout(() => {
      if (phaseRef.current === next) speechRef.current.start();
    }, LISTEN_DELAY_MS);
  }, []);

  /** Speaks (if replies are on), then listens again or ends. */
  const reply = useCallback(
    async (text: string, then: "listen" | "confirm" | "end" = "listen") => {
      if (phaseRef.current === "off") return;
      if (prefsRef.current.speakReplies && text) {
        setPhase("speaking");
        await speak(text);
        if (phaseRef.current !== "speaking") return;
      }
      if (then === "confirm") listen("confirming");
      else if (then === "listen" && prefsRef.current.keepListening) {
        listen("listening");
      } else end();
    },
    [speak, listen, end],
  );

  const words = {
    confirm: t("ai:ask.voiceMode.confirmWords"),
    cancel: t("ai:ask.voiceMode.cancelWords"),
  };

  const onTextRef = useRef<(text: string) => void>(() => {});
  onTextRef.current = (text: string) => {
    const pending = pendingRef.current;
    if (pending?.kind === "confirm") {
      const intent = confirmIntent(text, words);
      if (intent === "confirm") {
        pendingRef.current = { kind: "apply", turnId: pending.turnId };
        setPhase("thinking");
        inputRef.current.applyBuild(pending.turnId);
        return;
      }
      if (intent === "cancel") {
        inputRef.current.cancelBuild(pending.turnId);
        pendingRef.current = null;
        void reply(t("ai:ask.voiceMode.cancelled"));
        return;
      }
      // Anything else is a new request; the proposal stays on screen.
    }
    const { mode, askTurns, buildTurns } = inputRef.current;
    pendingRef.current =
      mode === "ask"
        ? { kind: "ask", index: askTurns.length }
        : { kind: "build", index: buildTurns.length };
    spokenRef.current = null;
    setPhase("thinking");
    inputRef.current.send(text);
  };

  // Follow the request it sent until there is something to say.
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || phase !== "thinking") return;
    const notes = {
      chartNote: t("ai:ask.voiceMode.chartNote"),
      moreNote: t("ai:ask.voiceMode.moreNote"),
    };
    const once = (key: string, run: () => void) => {
      if (spokenRef.current === key) return;
      spokenRef.current = key;
      run();
    };
    if (pending.kind === "ask") {
      const turn = input.askTurns[pending.index];
      if (!turn || turn.status === "streaming") return;
      once(`ask:${turn.id}:${turn.status}`, () => {
        pendingRef.current = null;
        const text =
          turn.status === "error" && turn.errorKey
            ? t(turn.errorKey)
            : turn.noResults
              ? t("ai:ask.noResults")
              : speakableText(turn.answer, notes);
        void reply(text);
      });
      return;
    }
    const turnId =
      pending.kind === "build"
        ? input.buildTurns[pending.index]?.id
        : pending.turnId;
    const turn = input.buildTurns.find((item) => item.id === turnId);
    if (!turn) return;
    if (turn.status === "planning" || turn.status === "applying") return;
    once(`build:${turn.id}:${turn.status}`, () => {
      if (turn.status === "error") {
        pendingRef.current = null;
        void reply(turn.errorKey ? t(turn.errorKey) : "");
        return;
      }
      if (turn.status === "applied") {
        pendingRef.current = null;
        const results = Object.values(turn.results);
        void reply(
          t("ai:ask.voiceMode.applied", {
            done: results.filter((result) => result.ok).length,
            total: results.length,
          }),
        );
        return;
      }
      if (turn.status !== "ready") return;
      if (turn.question) {
        pendingRef.current = null;
        const options = turn.question.options.join(", ");
        void reply(
          options ? `${turn.question.text} ${options}.` : turn.question.text,
        );
        return;
      }
      const ready = turn.actions.filter((action) =>
        willApply(action, turn.confirmed),
      ).length;
      if (turn.plan !== "proposal" || ready === 0) {
        pendingRef.current = null;
        void reply(turn.summary || t("ai:build.chat.nothing"));
        return;
      }
      const destructive = turn.actions.some(
        (action) => action.risk === "destructive",
      );
      pendingRef.current = { kind: "confirm", turnId: turn.id };
      void reply(
        [
          turn.summary,
          destructive ? t("ai:ask.voiceMode.needsClick") : "",
          t("ai:ask.voiceMode.confirmPrompt"),
        ]
          .filter(Boolean)
          .join(" "),
        "confirm",
      );
    });
  }, [phase, input.askTurns, input.buildTurns, t, reply]);

  const stop = useCallback(() => {
    hush();
    speechRef.current.cancel();
    end();
  }, [hush, end]);

  const toggle = useCallback(() => {
    if (phaseRef.current !== "off") {
      stop();
      return;
    }
    // Inside the click: unlocks the browser's voice for this page.
    prime();
    pendingRef.current = null;
    listen("listening");
  }, [stop, prime, listen]);

  /** Stops the spoken reply and moves on. */
  const skip = useCallback(() => hush(), [hush]);

  const confirm = useCallback(() => {
    const pending = pendingRef.current;
    if (pending?.kind !== "confirm") return;
    speechRef.current.cancel();
    pendingRef.current = { kind: "apply", turnId: pending.turnId };
    setPhase("thinking");
    inputRef.current.applyBuild(pending.turnId);
  }, []);

  const cancel = useCallback(() => {
    const pending = pendingRef.current;
    if (pending?.kind !== "confirm") return;
    speechRef.current.cancel();
    inputRef.current.cancelBuild(pending.turnId);
    pendingRef.current = null;
    void reply(t("ai:ask.voiceMode.cancelled"), "end");
  }, [reply, t]);

  const setPrefs = useCallback((patch: Partial<VoicePrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Private mode: the choice lasts until the page closes.
      }
      return next;
    });
  }, []);

  useEffect(() => () => hush(), [hush]);

  // While it listens, the recorder's own state says when it transcribes.
  const shown: VoicePhase =
    (phase === "listening" || phase === "confirming") &&
    speech.state === "transcribing"
      ? "transcribing"
      : phase;

  return {
    supported: speech.supported,
    phase: shown,
    startedAt: speech.startedAt,
    level: speech.level,
    prefs,
    setPrefs,
    toggle,
    stop,
    skip,
    confirm,
    cancel,
  };
}

export type VoiceMode = ReturnType<typeof useVoiceMode>;
