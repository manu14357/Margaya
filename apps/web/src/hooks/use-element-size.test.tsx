import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementSize } from "./use-element-size";

vi.setConfig({ testTimeout: 15_000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe({ fallback }: { fallback?: number }) {
  const { ref, width, height } = useElementSize(fallback);
  return (
    <div ref={ref} data-testid="probe">
      {width}x{height}
    </div>
  );
}

describe("useElementSize", () => {
  it("uses the fallback width until the element has a size", () => {
    render(<Probe fallback={240} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("240x0");
  });

  it("reports the measured size, rounded", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 512.4,
      height: 180.6,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 512.4,
      bottom: 180.6,
      toJSON: () => ({}),
    });
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("512x181");
  });
});
