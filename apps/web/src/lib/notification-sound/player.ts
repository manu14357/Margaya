import type { NotificationSoundId } from "./settings";
import { scheduleSound } from "./sounds";

// Browsers keep audio suspended until the page has had a click or key
// press, so the context is created or resumed on the first one. Until then
// notifications stay silent, without prompts or errors.

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;
let unlockInstalled = false;
let voiceActive = false;

function audioContextClass(): AudioContextClass | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextClass })
      .webkitAudioContext
  );
}

/** Creates or resumes the context; call it from a user gesture. */
export function unlockAudio() {
  const Context = audioContextClass();
  if (!Context) return;
  try {
    context ??= new Context();
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {
    context = null;
  }
}

/** Listens for the first gestures that may start audio; idempotent. */
export function installAudioUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    unlockAudio();
    if (context?.state === "running") {
      for (const name of ["pointerdown", "keydown"] as const) {
        window.removeEventListener(name, unlock, true);
      }
    }
  };
  for (const name of ["pointerdown", "keydown"] as const) {
    window.addEventListener(name, unlock, { capture: true, passive: true });
  }
}

export function audioReady(): boolean {
  return context?.state === "running";
}

/** Voice mode on: notification sounds must not talk over it. */
export function setVoiceActive(active: boolean) {
  voiceActive = active;
}

export function isVoiceActive(): boolean {
  return voiceActive;
}

/** Plays a sound now; false when audio cannot play yet. */
export function playSound(id: NotificationSoundId, volume: number): boolean {
  if (id === "none" || !context || context.state !== "running") return false;
  try {
    scheduleSound(context, id, volume);
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays a sound from a click (the settings' preview): the gesture starts
 * audio, so it waits for the context to run instead of giving up.
 */
export async function previewSound(
  id: NotificationSoundId,
  volume: number,
): Promise<boolean> {
  unlockAudio();
  if (context?.state === "suspended") {
    await context.resume().catch(() => {});
  }
  return playSound(id, volume);
}

/** For tests: forget the context and the listeners. */
export function resetAudioForTests() {
  context = null;
  unlockInstalled = false;
  voiceActive = false;
}
