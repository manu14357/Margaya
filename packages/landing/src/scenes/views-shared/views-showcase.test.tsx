import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { LandingCopyProvider } from "../../copy";
import type { DemoScene } from "../../demo";
import { finalStateOf, step } from "../../demo";
import { KeyboardSection } from "../../sections/keyboard-section";
import { withEndSignal } from "./end-signal";
import { ViewsShowcase } from "./views-showcase";

const tabs = messages.landing.home.views.tabs;

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

async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 32) {
    await act(async () => {
      vi.advanceTimersByTime(32);
    });
  }
}

function reduceMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const selectedTab = () =>
  screen
    .getAllByRole("tab")
    .find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

function show() {
  return render(
    <LandingCopyProvider copy={messages.landing}>
      <ViewsShowcase />
    </LandingCopyProvider>,
  );
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("withEndSignal", () => {
  type Action = { type: "inc" };
  const counter: DemoScene<number, Action> = {
    id: "counter",
    initialState: 0,
    reducer: (count) => count + 1,
    script: [step.set({ type: "inc" }), step.wait(100)],
    render: () => null,
  };

  it("wraps the inner actions and ends the script with the signal", () => {
    const wrapped = withEndSignal(counter, () => {});
    expect(wrapped.script.at(-1)).toEqual({
      kind: "set",
      action: { kind: "end" },
    });
    expect(finalStateOf(wrapped)).toEqual({ inner: 1, ended: true });
  });
});

// Mounting all five layout scenes is slow in jsdom, well past the 5s default
// even on an idle machine.
describe("ViewsShowcase", { timeout: 30_000 }, () => {
  it("advances to the next layout when a scene's script ends", async () => {
    show();
    expect(selectedTab()).toContain(tabs.board);
    await advance(9000);
    expect(selectedTab()).toContain(tabs.list);
  });

  it("stops advancing once the visitor picks a tab", async () => {
    show();
    const spreadsheet = screen.getByRole("tab", { name: tabs.spreadsheet });
    fireEvent.click(spreadsheet);
    expect(selectedTab()).toContain(tabs.spreadsheet);
    await advance(12000);
    expect(selectedTab()).toContain(tabs.spreadsheet);
  });

  it("moves between tabs with the arrow keys", () => {
    show();
    const board = screen.getByRole("tab", { name: tabs.board });
    fireEvent.keyDown(board, { key: "ArrowLeft" });
    expect(selectedTab()).toContain(tabs.gantt);
    expect(document.activeElement?.textContent).toContain(tabs.gantt);
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(selectedTab()).toContain(tabs.board);
  });

  it("renders every layout's still frame with reduced motion, never advancing", async () => {
    reduceMotion();
    show();
    for (const id of [
      "board",
      "list",
      "spreadsheet",
      "calendar",
      "gantt",
    ] as const) {
      fireEvent.click(screen.getByRole("tab", { name: tabs[id] }));
      await act(async () => {});
      expect(selectedTab()).toContain(tabs[id]);
    }
    const canvas = document.querySelector("[data-demo-canvas]");
    expect(canvas?.querySelector('[data-demo="dependency-line"]')).toBeTruthy();
    await advance(3000);
    expect(selectedTab()).toContain(tabs.gantt);
  });
});

describe("KeyboardSection", () => {
  it("shows the palette's final frame and the shortcut list", async () => {
    reduceMotion();
    render(
      <LandingCopyProvider copy={messages.landing}>
        <KeyboardSection />
      </LandingCopyProvider>,
    );
    await act(async () => {});
    expect(screen.getByRole("status").textContent).toContain(
      messages.landing.demo.palette.toast,
    );
    const shortcuts = messages.landing.home.keyboard;
    expect(screen.getByText(shortcuts.items.palette)).toBeTruthy();
    expect(screen.getAllByText(shortcuts.modifier).length).toBeGreaterThan(0);
  });
});
