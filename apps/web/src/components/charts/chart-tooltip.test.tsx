import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHART_SLOT_COLORS } from "@/lib/charts/series-colors";
import ChartLegend from "./chart-legend";
import ChartTooltip, {
  ChartAnnouncer,
  type ChartReadout,
  placeTooltip,
} from "./chart-tooltip";

vi.setConfig({ testTimeout: 15_000 });

afterEach(() => {
  cleanup();
});

const bounds = { width: 300, height: 200 };
const size = { width: 100, height: 40 };

describe("placeTooltip", () => {
  it("centers above the anchor when there is room", () => {
    expect(
      placeTooltip({
        anchor: { x: 150, y: 100 },
        size,
        bounds,
        placement: "above",
      }),
    ).toEqual({ left: 100, top: 52 });
  });

  it("flips below the anchor near the top", () => {
    expect(
      placeTooltip({
        anchor: { x: 150, y: 20 },
        size,
        bounds,
        placement: "above",
      }),
    ).toEqual({ left: 100, top: 28 });
  });

  it("flips below the marked area's lower edge when one is given", () => {
    expect(
      placeTooltip({
        anchor: { x: 150, y: 20, below: 48 },
        size,
        bounds,
        placement: "above",
      }).top,
    ).toBe(56);
  });

  it("stays inside the container horizontally", () => {
    expect(
      placeTooltip({
        anchor: { x: 10, y: 100 },
        size,
        bounds,
        placement: "above",
      }).left,
    ).toBe(0);
    expect(
      placeTooltip({
        anchor: { x: 295, y: 100 },
        size,
        bounds,
        placement: "above",
      }).left,
    ).toBe(200);
  });

  it("goes right of the anchor on the side, flipping left near the edge", () => {
    expect(
      placeTooltip({
        anchor: { x: 50, y: 100 },
        size,
        bounds,
        placement: "side",
      }),
    ).toEqual({ left: 58, top: 80 });
    expect(
      placeTooltip({
        anchor: { x: 250, y: 100 },
        size,
        bounds,
        placement: "side",
      }),
    ).toEqual({ left: 142, top: 80 });
    expect(
      placeTooltip({
        anchor: { x: 250, y: 5 },
        size,
        bounds,
        placement: "side",
      }).top,
    ).toBe(0);
  });
});

const readout: ChartReadout = {
  title: "Week of Mar 2, 2026",
  rows: [
    { key: "bug", label: "Bug", value: "2", color: CHART_SLOT_COLORS[0] },
    { key: "none", label: "No label", value: "3" },
  ],
  total: { label: "Total", value: "4" },
};

describe("ChartTooltip", () => {
  it("shows swatches, values and a total row, hidden from screen readers", () => {
    const { container } = render(
      <ChartTooltip
        readout={readout}
        anchor={{ x: 50, y: 50 }}
        bounds={bounds}
      />,
    );
    const tooltip = container.querySelector('[data-slot="chart-tooltip"]');
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(tooltip).toHaveTextContent("Week of Mar 2, 2026");
    const rows = tooltip?.querySelectorAll("li") ?? [];
    expect(rows[0]).toHaveTextContent("Bug2");
    expect(rows[0].querySelector(".bg-chart-1")).not.toBeNull();
    expect(rows[1]).toHaveTextContent("No label3");
    expect(tooltip).toHaveTextContent("Total4");
  });
});

describe("ChartAnnouncer", () => {
  it("is a polite live region that stays mounted while empty", () => {
    const { rerender } = render(<ChartAnnouncer readout={null} />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass("sr-only");

    rerender(<ChartAnnouncer readout={readout} />);
    expect(screen.getByRole("status")).toBe(region);
    const rows = within(region).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Bug2");
    expect(within(region).getByText("Total").nextSibling).toHaveTextContent(
      "4",
    );
  });
});

describe("ChartLegend", () => {
  it("lists two or more series and hides a single one", () => {
    const items = [
      { key: "a", label: "Created", color: CHART_SLOT_COLORS[0] },
      { key: "b", label: "Completed", color: CHART_SLOT_COLORS[1] },
    ];
    const { rerender } = render(<ChartLegend items={items} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    rerender(<ChartLegend items={items.slice(0, 1)} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("paints custom colors inline", () => {
    render(
      <ChartLegend
        items={[
          {
            key: "a",
            label: "Bug",
            color: { fill: "", stroke: "", swatch: "", value: "#ef4444" },
          },
          { key: "b", label: "Idea", color: CHART_SLOT_COLORS[1] },
        ]}
      />,
    );
    const swatch = screen.getByText("Bug").previousElementSibling;
    expect(swatch).toHaveStyle({ backgroundColor: "#ef4444" });
  });
});
