import { cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOAST_LIFT_VAR, useLiftToasts } from "./use-lift-toasts";

function Bar({ shown }: { shown: boolean }) {
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useLiftToasts(bar);
  return shown ? <div ref={setBar} /> : null;
}

const lift = () =>
  document.documentElement.style.getPropertyValue(TOAST_LIFT_VAR);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLiftToasts", () => {
  it("lifts toasts above the bar while it is shown", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: window.innerHeight - 70,
    } as DOMRect);

    const { rerender } = render(<Bar shown />);
    expect(lift()).toBe("70px");

    rerender(<Bar shown={false} />);
    expect(lift()).toBe("");
  });
});
