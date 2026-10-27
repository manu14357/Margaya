import { useCallback, useEffect, useRef, useState } from "react";
import { speechChunks } from "./voice-reply";

// The browser's own voice (speechSynthesis) for voice mode's spoken replies.
// Nothing leaves the browser. Text is queued sentence by sentence because
// Chromium silently stops one long utterance after about 15 seconds.

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

/**
 * The best voice for a language: one for the exact locale, then the
 * language; neural ("Natural", "Online") voices first, then the default.
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  const base = lang.split("-")[0]?.toLowerCase() ?? "";
  const score = (voice: SpeechSynthesisVoice) => {
    const voiceLang = voice.lang.toLowerCase().replace("_", "-");
    let points = 0;
    if (voiceLang === lang.toLowerCase()) points += 4;
    else if (voiceLang.split("-")[0] === base) points += 3;
    else return -1;
    if (/natural|online|neural/i.test(voice.name)) points += 2;
    if (voice.default) points += 1;
    return points;
  };
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const points = score(voice);
    if (points > bestScore) {
      best = voice;
      bestScore = points;
    }
  }
  return best;
}

export function useSpeaker(lang: string) {
  const supported = synth() !== null;
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    const speech = synth();
    if (!speech) return;
    const load = () => {
      voiceRef.current = pickVoice(speech.getVoices(), lang);
    };
    load();
    // Chrome, Edge and Firefox load their voices after the page.
    speech.addEventListener?.("voiceschanged", load);
    return () => speech.removeEventListener?.("voiceschanged", load);
  }, [lang]);

  useEffect(() => () => synth()?.cancel(), []);

  /**
   * Call from a click: browsers only let a page speak after a person has
   * interacted with it, and this silent utterance unlocks later ones.
   */
  const prime = useCallback(() => {
    const speech = synth();
    if (!speech) return;
    const unlock = new SpeechSynthesisUtterance(" ");
    unlock.volume = 0;
    speech.speak(unlock);
  }, []);

  /** Stops speaking at once; a pending `speak` resolves. */
  const cancel = useCallback(() => {
    runRef.current += 1;
    synth()?.cancel();
    setSpeaking(false);
  }, []);

  /** Reads the text aloud; resolves when done, cancelled or failed. */
  const speak = useCallback(
    (text: string): Promise<void> => {
      const speech = synth();
      const chunks = speechChunks(text);
      if (!speech || chunks.length === 0) return Promise.resolve();
      speech.cancel();
      const run = ++runRef.current;
      setSpeaking(true);
      return new Promise((resolve) => {
        let left = chunks.length;
        const finish = () => {
          if (runRef.current === run) setSpeaking(false);
          resolve();
        };
        for (const chunk of chunks) {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.lang = lang;
          if (voiceRef.current) utterance.voice = voiceRef.current;
          utterance.onend = () => {
            left -= 1;
            if (left === 0 || runRef.current !== run) finish();
          };
          // "interrupted" and "canceled" come from cancel(); either way
          // the reply is over.
          utterance.onerror = () => {
            left = 0;
            finish();
          };
          speech.speak(utterance);
        }
      });
    },
    [lang],
  );

  return { supported, speaking, prime, speak, cancel };
}
