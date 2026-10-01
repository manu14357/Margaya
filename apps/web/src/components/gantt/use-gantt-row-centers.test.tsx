import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGanttRowCenters } from "./use-gantt-row-centers";

let renders = 0;
let latestCenters: ReadonlyMap<string, number> = new Map();

// The page builds the layout key inline, so it is a new array on every render.
// The hook must not turn that into an endless update loop.
function Harness({ enabled, rows }: { enabled: boolean; rows: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  renders += 1;
  latestCenters = useGanttRowCenters(ref, [rows, Date.now()], enabled);
  return (
    <div ref={ref}>
      {rows.map((id) => (
        <div key={id} data-gantt-row={id} />
      ))}
    </div>
  );
}

describe("useGanttRowCenters", () => {
  beforeEach(() => {
    renders = 0;
    latestCenters = new Map();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("settles when the key changes on every render and rows are measured", () => {
    render(<Harness enabled rows={["a", "b"]} />);
    expect(renders).toBeLessThan(10);
    expect([...latestCenters.keys()].sort()).toEqual(["a", "b"]);
  });

  it("settles when disabled", () => {
    render(<Harness enabled={false} rows={["a", "b"]} />);
    expect(renders).toBeLessThan(10);
    expect(latestCenters.size).toBe(0);
  });

  it("clears the measurements when it becomes disabled", () => {
    const { rerender } = render(<Harness enabled rows={["a"]} />);
    expect(latestCenters.size).toBe(1);
    rerender(<Harness enabled={false} rows={["a"]} />);
    expect(latestCenters.size).toBe(0);
  });
});
