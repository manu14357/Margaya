import { describe, expect, it, vi } from "vitest";
import { NOTIFICATION_SOUNDS } from "./settings";
import { SOUND_RECIPES, scheduleSound, volumeGain } from "./sounds";

function fakeContext() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const gains: { gain: ReturnType<typeof param> }[] = [];
  const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    currentTime: 1,
    destination: {},
    createGain: () => {
      const node = { gain: param(), connect: vi.fn() };
      gains.push(node);
      return node;
    },
    createOscillator: () => {
      const node = {
        type: "sine",
        frequency: param(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(node);
      return node;
    },
  };
  return { context: context as unknown as AudioContext, gains, oscillators };
}

describe("notification sounds", () => {
  it("has a short recipe for every sound but none", () => {
    for (const id of NOTIFICATION_SOUNDS) {
      if (id === "none") continue;
      const notes = SOUND_RECIPES[id];
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) expect(note.at + note.dur).toBeLessThan(1.5);
    }
  });

  it("schedules one oscillator per note behind a master gain", () => {
    const { context, gains, oscillators } = fakeContext();
    scheduleSound(context, "marimba", 100);
    expect(oscillators).toHaveLength(SOUND_RECIPES.marimba.length);
    expect(gains[0]?.gain.value).toBe(volumeGain(100));
    for (const osc of oscillators) expect(osc.start).toHaveBeenCalled();
  });

  it("maps volume to gain on a curve, clamped", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBe(0.5);
    expect(volumeGain(50)).toBeCloseTo(0.125);
    expect(volumeGain(500)).toBe(0.5);
  });
});
