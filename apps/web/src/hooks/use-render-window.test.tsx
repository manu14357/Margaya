import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRenderWindow } from "./use-render-window";

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let observers: { callback: Callback; disconnected: boolean }[] = [];

class FakeObserver {
  private entry: { callback: Callback; disconnected: boolean };
  constructor(callback: Callback) {
    this.entry = { callback, disconnected: false };
    observers.push(this.entry);
  }
  observe() {}
  disconnect() {
    this.entry.disconnected = true;
  }
}

function List({ total, step }: { total: number; step: number }) {
  const { count, hasMore, sentinelRef } = useRenderWindow(total, step);
  return (
    <div>
      {Array.from({ length: count }, (_, index) => `row-${index}`).map((id) => (
        <p key={id}>{id}</p>
      ))}
      {hasMore && <span data-testid="sentinel" ref={sentinelRef} />}
    </div>
  );
}

const live = () => observers.filter((observer) => !observer.disconnected);

afterEach(() => {
  cleanup();
  observers = [];
  vi.unstubAllGlobals();
});

describe("useRenderWindow", () => {
  it("mounts everything when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<List total={7} step={3} />);
    expect(container.querySelectorAll("p")).toHaveLength(7);
  });

  it("mounts one step, then another each time the sentinel comes into view", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { container, queryByTestId } = render(<List total={7} step={3} />);
    expect(container.querySelectorAll("p")).toHaveLength(3);

    act(() => live()[0]?.callback([{ isIntersecting: false }]));
    expect(container.querySelectorAll("p")).toHaveLength(3);

    act(() => live()[0]?.callback([{ isIntersecting: true }]));
    expect(container.querySelectorAll("p")).toHaveLength(6);
    // The observer is re-armed for the next step.
    expect(live()).toHaveLength(1);

    act(() => live()[0]?.callback([{ isIntersecting: true }]));
    expect(container.querySelectorAll("p")).toHaveLength(7);
    expect(queryByTestId("sentinel")).toBeNull();
    expect(live()).toHaveLength(0);
  });

  it("mounts short lists whole without a sentinel", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { container, queryByTestId } = render(<List total={2} step={3} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(queryByTestId("sentinel")).toBeNull();
    expect(observers).toHaveLength(0);
  });
});
