import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../i18n/en-US.json";
import { LandingCopyProvider } from "../copy";
import { DemoStage } from "./stage";
import { step } from "./steps";
import type { DemoScene, Step } from "./types";

type State = { count: number; text: string };
type Action = { type: "inc" } | { type: "text"; value: string };

function scene(script: Step<Action>[]): DemoScene<State, Action> {
  return {
    id: "test",
    initialState: { count: 0, text: "" },
    reducer: (state, action) =>
      action.type === "inc"
        ? { ...state, count: state.count + 1 }
        : { ...state, text: action.value },
    script,
    render: ({ state, interactive }) => (
      <output data-testid="state" data-interactive={interactive}>
        {state.count}:{state.text}
      </output>
    ),
  };
}

const counting = scene([
  step.set({ type: "inc" }),
  step.wait(300),
  step.set({ type: "inc" }),
  step.wait(300),
  step.set({ type: "inc" }),
]);

function wrap(children: ReactNode) {
  return (
    <LandingCopyProvider copy={messages.landing}>
      {children}
    </LandingCopyProvider>
  );
}

const shown = () => screen.getByTestId("state").textContent;

async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    await act(async () => {
      vi.advanceTimersByTime(16);
    });
  }
}

function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

class VisibleObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
    ],
  });
  vi.stubGlobal("IntersectionObserver", VisibleObserver);
  setTabHidden(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("DemoStage", () => {
  it("plays the script on screen", async () => {
    render(
      wrap(
        <DemoStage scene={counting} caption="c" description="d" loop={false} />,
      ),
    );
    expect(shown()).toBe("0:");
    await advance(1200);
    expect(shown()).toBe("3:");
  });

  it("pauses while the tab is hidden", async () => {
    render(
      wrap(
        <DemoStage scene={counting} caption="c" description="d" loop={false} />,
      ),
    );
    await advance(100);
    expect(shown()).toBe("1:");
    await act(async () => setTabHidden(true));
    await advance(3000);
    expect(shown()).toBe("1:");
    await act(async () => setTabHidden(false));
    await advance(1200);
    expect(shown()).toBe("3:");
  });

  it("stops the script when unmounted", async () => {
    const toAction = vi.fn(
      (value: string): Action => ({ type: "text", value }),
    );
    const typing = scene([step.wait(300), step.type("field", "abc", toAction)]);
    const { unmount } = render(
      wrap(<DemoStage scene={typing} caption="c" description="d" />),
    );
    await advance(100);
    unmount();
    await advance(3000);
    // The still frame is computed with the full text; typing would start at "a".
    expect(toAction).not.toHaveBeenCalledWith("a");
  });

  it("shows the final still frame with reduced motion", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    const typing = scene([
      step.set({ type: "inc" }),
      step.wait(5000),
      step.type("field", "done", (value) => ({ type: "text", value })),
    ]);
    const { container } = render(
      wrap(<DemoStage scene={typing} caption="c" description="d" />),
    );
    await act(async () => {});
    expect(shown()).toBe("1:done");
    expect(screen.getByTestId("state").dataset.interactive).toBe("true");
    expect(container.querySelector("[data-kind]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hands the replica over when the visitor interacts", async () => {
    const { container } = render(
      wrap(
        <DemoStage scene={counting} caption="c" description="d" loop={false} />,
      ),
    );
    await advance(100);
    expect(shown()).toBe("1:");
    const canvas = container.querySelector("[data-demo-canvas]");
    if (!canvas) throw new Error("no canvas");
    fireEvent.pointerDown(canvas);
    await advance(2000);
    expect(shown()).toBe("1:");
    expect(screen.getByTestId("state").dataset.interactive).toBe("true");
    expect(
      screen.getByRole("button", {
        name: messages.landing.demo.controls.replay,
      }),
    ).toBeTruthy();
  });
});
