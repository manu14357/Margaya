import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskTurn } from "./use-ask-session";
import { useVoiceMode } from "./use-voice-mode";

const m = vi.hoisted(() => ({
  onText: (_text: string) => {},
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/ai/build/build-turn", () => ({ willApply: () => true }));
vi.mock("./use-speech-input", () => ({
  useSpeechInput: (options: { onText: (text: string) => void }) => {
    m.onText = options.onText;
    return {
      supported: true,
      state: "idle",
      startedAt: null,
      level: 0,
      start: vi.fn(),
      cancel: vi.fn(),
    };
  },
}));

const speech = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };

beforeEach(() => {
  speech.speak.mockClear();
  speech.cancel.mockClear();
  vi.stubGlobal("speechSynthesis", speech);
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const answer = (text: string) =>
  ({
    id: 1,
    status: "done",
    answer: text,
    noResults: false,
  }) as unknown as AskTurn;

describe("useVoiceMode", () => {
  it("keeps reading a reply aloud while the panel re-renders", () => {
    const send = vi.fn();
    const base = {
      workspaceId: "w1",
      server: true,
      lang: "en-US",
      mode: "ask" as const,
      buildTurns: [],
      send,
      applyBuild: vi.fn(),
      cancelBuild: vi.fn(),
      onError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props: { askTurns: readonly AskTurn[] }) =>
        useVoiceMode({ ...base, ...props }),
      { initialProps: { askTurns: [] } },
    );

    act(() => result.current.toggle());
    act(() => m.onText("What is due this week?"));
    expect(send).toHaveBeenCalledWith("What is due this week?");

    rerender({ askTurns: [answer("Two tasks are due.")] });
    expect(result.current.phase).toBe("speaking");
    const spoken = speech.speak.mock.calls.map(([u]) => u.text);
    expect(spoken).toContain("Two tasks are due.");

    // Re-renders (new turns, a level meter tick) must not cut it off.
    const cancels = speech.cancel.mock.calls.length;
    rerender({ askTurns: [answer("Two tasks are due.")] });
    rerender({ askTurns: [answer("Two tasks are due.")] });
    expect(speech.cancel.mock.calls.length).toBe(cancels);
    expect(result.current.phase).toBe("speaking");
  });
});
