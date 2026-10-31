import type { NotificationSoundId } from "./settings";

// Every sound is synthesized with Web Audio: no files to load, nothing for
// the CSP to allow, and self-hosted installs need no assets.

type Note = {
  /** Hz at the start; `to` glides there over the note. */
  freq: number;
  to?: number;
  /** Seconds after the sound starts. */
  at: number;
  /** Seconds until the note has faded out. */
  dur: number;
  wave: OscillatorType;
  /** Relative loudness, 0 to 1. */
  gain: number;
};

export const SOUND_RECIPES: Record<
  Exclude<NotificationSoundId, "none">,
  Note[]
> = {
  // Two rising notes, soft.
  chime: [
    { freq: 880, at: 0, dur: 0.35, wave: "sine", gain: 0.8 },
    { freq: 1318.5, at: 0.12, dur: 0.45, wave: "sine", gain: 0.7 },
  ],
  // A short upward blip.
  pop: [{ freq: 520, to: 980, at: 0, dur: 0.09, wave: "sine", gain: 1 }],
  // One bright note with an overtone.
  ding: [
    { freq: 1046.5, at: 0, dur: 0.6, wave: "sine", gain: 0.8 },
    { freq: 2093, at: 0, dur: 0.3, wave: "sine", gain: 0.2 },
  ],
  // A rounder, longer bell.
  bell: [
    { freq: 784, at: 0, dur: 1, wave: "sine", gain: 0.8 },
    { freq: 1568, at: 0, dur: 0.6, wave: "sine", gain: 0.25 },
    { freq: 2352, at: 0, dur: 0.35, wave: "sine", gain: 0.12 },
  ],
  // Two low taps, like knocking: someone is waiting.
  knock: [
    { freq: 210, to: 120, at: 0, dur: 0.1, wave: "sine", gain: 1 },
    { freq: 210, to: 120, at: 0.16, dur: 0.1, wave: "sine", gain: 1 },
  ],
  // Three quick ascending wooden notes.
  marimba: [
    { freq: 523.25, at: 0, dur: 0.22, wave: "triangle", gain: 0.9 },
    { freq: 659.25, at: 0.09, dur: 0.22, wave: "triangle", gain: 0.9 },
    { freq: 783.99, at: 0.18, dur: 0.3, wave: "triangle", gain: 0.9 },
  ],
};

/** Perceived loudness grows roughly with the square of the gain. */
export function volumeGain(volume: number): number {
  const v = Math.min(100, Math.max(0, volume)) / 100;
  return v * v * 0.5;
}

/** Schedules a sound on a running context. */
export function scheduleSound(
  context: AudioContext,
  id: Exclude<NotificationSoundId, "none">,
  volume: number,
) {
  const master = context.createGain();
  master.gain.value = volumeGain(volume);
  master.connect(context.destination);
  const start = context.currentTime + 0.01;
  for (const note of SOUND_RECIPES[id]) {
    const osc = context.createOscillator();
    const env = context.createGain();
    const t0 = start + note.at;
    osc.type = note.wave;
    osc.frequency.setValueAtTime(note.freq, t0);
    if (note.to)
      osc.frequency.exponentialRampToValueAtTime(note.to, t0 + note.dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(note.gain, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  }
}
