import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepAnchorInView } from "./keep-anchor-in-view";

type ResizeCallback = () => void;
const observers: Array<{ callback: ResizeCallback; disconnected: boolean }> =
  [];

class FakeResizeObserver {
  private entry: { callback: ResizeCallback; disconnected: boolean };
  constructor(callback: ResizeCallback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

const resize = () => {
  for (const observer of observers) {
    if (!observer.disconnected) observer.callback();
  }
};

function setup() {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  const content = document.createElement("div");
  const target = document.createElement("div");
  content.append(target);
  scroller.append(content);
  document.body.append(scroller);
  const scrollIntoView = vi.fn();
  target.scrollIntoView = scrollIntoView;
  return { target, scrollIntoView };
}

describe("keepAnchorInView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observers.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("centres the anchor at once and again while the page grows", () => {
    const { target, scrollIntoView } = setup();
    keepAnchorInView(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    resize();
    resize();
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it("lets go once the person scrolls", () => {
    const { target, scrollIntoView } = setup();
    keepAnchorInView(target);
    window.dispatchEvent(new Event("wheel"));
    resize();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("lets go after the time limit and on cleanup", () => {
    const first = setup();
    keepAnchorInView(first.target, { maxMs: 1000 });
    vi.advanceTimersByTime(1000);
    resize();
    expect(first.scrollIntoView).toHaveBeenCalledTimes(1);

    const second = setup();
    const stop = keepAnchorInView(second.target);
    stop();
    resize();
    expect(second.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
