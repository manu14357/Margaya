import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHART_SLOT_COLORS,
  GROUP_CHART_COLORS,
} from "@/lib/charts/series-colors";
import LineChart, { type LineChartSeries } from "./line-chart";

vi.setConfig({ testTimeout: 15_000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const labels = ["Mar 2", "Mar 9", "Mar 16", "Mar 23"];

const trend: LineChartSeries[] = [
  {
    key: "created",
    label: "Created",
    color: CHART_SLOT_COLORS[0],
    values: [5, 1, 2, 0],
  },
  {
    key: "completed",
    label: "Completed",
    color: GROUP_CHART_COLORS.completed,
    values: [0, 1, null, 1],
  },
];

function mockContainerWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width,
    height: 0,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 0,
    toJSON: () => ({}),
  });
}

describe("LineChart", () => {
  it("draws one path per series, split at nulls, and a hover slot per position", () => {
    const { container } = render(
      <LineChart
        labels={labels}
        series={trend}
        ariaLabel="Created vs completed over 4 periods"
      />,
    );
    expect(
      screen.getByRole("img", { name: "Created vs completed over 4 periods" }),
    ).toHaveAttribute("tabindex", "0");
    expect(container.querySelectorAll("[data-chart-index]")).toHaveLength(4);
    const completed = container.querySelector(
      '[data-chart-series="completed"] path',
    );
    expect(completed?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(completed).toHaveClass("stroke-success");
  });

  it("shows a crosshair, markers and every series in one tooltip", () => {
    const { container } = render(
      <LineChart
        labels={labels}
        series={trend}
        tooltipTitle={(index) => `Week of ${labels[index]}`}
        ariaLabel="Trend"
      />,
    );
    const svg = screen.getByRole("img", { name: "Trend" });
    act(() => svg.focus());
    expect(container.querySelector("[data-chart-crosshair]")).not.toBeNull();
    expect(container.querySelectorAll("[data-chart-marker]")).toHaveLength(2);
    let tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Week of Mar 2");
    expect(within(tooltip).getByText("Created").nextSibling).toHaveTextContent(
      "5",
    );
    expect(
      within(tooltip).getByText("Completed").nextSibling,
    ).toHaveTextContent("0");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Week of Mar 16");
    // A null value has no marker and reads as a dash.
    expect(container.querySelectorAll("[data-chart-marker]")).toHaveLength(1);
    expect(
      within(tooltip).getByText("Completed").nextSibling,
    ).toHaveTextContent("–");

    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("Week of Mar 23");
    fireEvent.keyDown(svg, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Week of Mar 2");
    // Vertical arrows are not a line chart's axis.
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(screen.getByRole("status")).toHaveTextContent("Week of Mar 2");

    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(container.querySelector("[data-chart-crosshair]")).toBeNull();
  });

  it("follows the pointer between positions", () => {
    const { container } = render(
      <LineChart labels={labels} series={trend} ariaLabel="Trend" />,
    );
    const slot = container.querySelector('[data-chart-index="1"]');
    if (!slot) throw new Error("missing slot");
    fireEvent.mouseMove(slot);
    expect(screen.getByRole("status")).toHaveTextContent("Mar 9");
    fireEvent.mouseLeave(screen.getByRole("img", { name: "Trend" }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("labels two to four line ends directly when there is room", () => {
    mockContainerWidth(640);
    const { container, rerender } = render(
      <LineChart labels={labels} series={trend} ariaLabel="Trend" />,
    );
    const endLabels = container.querySelectorAll("[data-chart-end-label]");
    expect(Array.from(endLabels, (label) => label.textContent)).toEqual([
      "Created",
      "Completed",
    ]);

    const five = Array.from({ length: 5 }, (_, index) => ({
      key: `s${index}`,
      label: `Series ${index}`,
      color: CHART_SLOT_COLORS[index],
      values: [index, index + 1, index, index + 2],
    }));
    rerender(<LineChart labels={labels} series={five} ariaLabel="Trend" />);
    expect(container.querySelectorAll("[data-chart-end-label]")).toHaveLength(
      0,
    );
  });

  it("skips direct labels in a narrow container", () => {
    const { container } = render(
      <LineChart labels={labels} series={trend} ariaLabel="Trend" />,
    );
    expect(container.querySelectorAll("[data-chart-end-label]")).toHaveLength(
      0,
    );
  });

  it("shows a legend for several series and none for one", () => {
    const { rerender } = render(
      <LineChart labels={labels} series={trend} ariaLabel="Trend" />,
    );
    const legend = screen.getByRole("list");
    expect(within(legend).getAllByRole("listitem")).toHaveLength(2);

    rerender(
      <LineChart
        labels={labels}
        series={trend.slice(0, 1)}
        ariaLabel="Trend"
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders nothing without positions", () => {
    const { container } = render(
      <LineChart labels={[]} series={[]} ariaLabel="Empty" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
