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
  GROUP_CHART_COLORS,
  PRIORITY_CHART_COLORS,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import BarChart, { type BarChartDatum } from "./bar-chart";

vi.setConfig({ testTimeout: 15_000 });

afterEach(() => {
  cleanup();
});

const NAMES: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  low: "Low",
};

const priorities: BarChartDatum[] = [
  { key: "urgent", value: 2, color: PRIORITY_CHART_COLORS.urgent },
  { key: "high", value: 5, color: PRIORITY_CHART_COLORS.high },
  { key: "low", value: 1, color: PRIORITY_CHART_COLORS.low },
];

const tasksSeries = [
  { key: "value", label: "Tasks", color: SINGLE_SERIES_COLOR },
];

function manyBuckets(count: number): BarChartDatum[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `user-${index}`,
    value: index + 1,
  }));
}

function chart() {
  return screen.getByRole("img", { name: /Tasks by priority/ });
}

describe("BarChart", () => {
  it("renders one band per bucket with the aria-label summary", () => {
    const { container } = render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        categoryLabel={(key) => NAMES[key]}
        ariaLabel="Tasks by priority: 3 buckets, highest High with 5"
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Tasks by priority: 3 buckets, highest High with 5",
      }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-chart-band]")).toHaveLength(3);
    // Plain bars keep their identity colors.
    const urgentBar = container.querySelector(
      '[data-chart-band="urgent"] [data-chart-segment]',
    );
    expect(urgentBar).toHaveClass("fill-(--priority-urgent)");
  });

  it("moves between bars with the keyboard and shows the tooltip", () => {
    render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        categoryLabel={(key) => NAMES[key]}
        ariaLabel="Tasks by priority"
      />,
    );
    const svg = chart();
    expect(svg).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => svg.focus());
    let tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Urgent");
    expect(tooltip).toHaveTextContent("Tasks");
    expect(tooltip).toHaveTextContent("2");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    tooltip = screen.getByRole("status");
    expect(within(tooltip).getByText("High")).toBeInTheDocument();
    expect(tooltip).toHaveTextContent("5");

    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("Low");

    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(screen.getByRole("status")).toHaveTextContent("High");

    fireEvent.keyDown(svg, { key: "Home" });
    expect(screen.getByRole("status")).toHaveTextContent("Urgent");

    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => svg.blur());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("uses Up and Down for horizontal bars", () => {
    render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        orientation="horizontal"
        categoryLabel={(key) => NAMES[key]}
        ariaLabel="Tasks by priority"
      />,
    );
    const svg = chart();
    act(() => svg.focus());
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Urgent");
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    expect(screen.getByRole("status")).toHaveTextContent("High");
    fireEvent.keyDown(svg, { key: "ArrowUp" });
    expect(screen.getByRole("status")).toHaveTextContent("Urgent");
  });

  it("shows the tooltip on hover and hides it when the pointer leaves", () => {
    const { container } = render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        categoryLabel={(key) => NAMES[key]}
        tooltipTitle={(key) => `Priority: ${NAMES[key]}`}
        ariaLabel="Tasks by priority"
      />,
    );
    const band = container.querySelector('[data-chart-band="low"] rect');
    if (!band) throw new Error("missing band");
    fireEvent.mouseMove(band);
    expect(screen.getByRole("status")).toHaveTextContent("Priority: Low");
    // The visual copy is hidden from screen readers, which get the announcer.
    const tooltip = container.querySelector('[data-slot="chart-tooltip"]');
    expect(tooltip).toHaveAttribute("aria-hidden", "true");
    expect(tooltip).toHaveTextContent("Priority: Low");

    fireEvent.mouseLeave(chart());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(container.querySelector('[data-slot="chart-tooltip"]')).toBeNull();
  });

  it("labels bar ends directly only with at most 20 bars", () => {
    const { container, rerender } = render(
      <BarChart
        data={manyBuckets(20)}
        series={tasksSeries}
        orientation="horizontal"
        categoryLabel={(key) => key}
        ariaLabel="Tasks by assignee"
      />,
    );
    const labels = container.querySelectorAll("[data-chart-value-label]");
    expect(labels).toHaveLength(20);
    expect(labels[19]).toHaveTextContent("20");

    rerender(
      <BarChart
        data={manyBuckets(21)}
        series={tasksSeries}
        orientation="horizontal"
        categoryLabel={(key) => key}
        ariaLabel="Tasks by assignee"
      />,
    );
    expect(container.querySelectorAll("[data-chart-value-label]")).toHaveLength(
      0,
    );
    expect(container.querySelectorAll("[data-chart-band]")).toHaveLength(21);
  });

  it("never labels vertical bars directly", () => {
    const { container } = render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        categoryLabel={(key) => NAMES[key]}
        ariaLabel="Tasks by priority"
      />,
    );
    expect(container.querySelectorAll("[data-chart-value-label]")).toHaveLength(
      0,
    );
  });

  it("stacks segments, lists them in the tooltip and adds the distinct total", () => {
    const series = [
      {
        key: "unstarted",
        label: "Not started",
        color: GROUP_CHART_COLORS.unstarted,
      },
      { key: "started", label: "Started", color: GROUP_CHART_COLORS.started },
      {
        key: "completed",
        label: "Completed",
        color: GROUP_CHART_COLORS.completed,
      },
    ];
    const { container } = render(
      <BarChart
        data={[
          { key: "m1", value: 4, cells: { unstarted: 2, completed: 2 } },
          { key: "m2", value: 3, cells: { unstarted: 1, started: 3 } },
        ]}
        series={series}
        stacked
        orientation="horizontal"
        categoryLabel={(key) => key.toUpperCase()}
        ariaLabel="Workload"
        totalLabel="Total"
      />,
    );
    const firstBand = container.querySelector('[data-chart-band="m1"]');
    expect(
      Array.from(
        firstBand?.querySelectorAll("[data-chart-segment]") ?? [],
        (segment) => segment.getAttribute("data-chart-segment"),
      ),
    ).toEqual(["unstarted", "completed"]);

    // A stacked chart with several series has a legend.
    const legend = screen.getByRole("list");
    expect(within(legend).getAllByRole("listitem")).toHaveLength(3);

    const svg = screen.getByRole("img", { name: "Workload" });
    act(() => svg.focus());
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("M2");
    expect(within(tooltip).getByText("Not started")).toBeInTheDocument();
    expect(within(tooltip).getByText("Started")).toBeInTheDocument();
    expect(within(tooltip).queryByText("Completed")).toBeNull();
    // The stack is 4 tall, but the bucket's distinct total is 3.
    expect(within(tooltip).getByText("Total").nextSibling).toHaveTextContent(
      "3",
    );
  });

  it("has no legend for a single series", () => {
    render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        categoryLabel={(key) => NAMES[key]}
        ariaLabel="Tasks by priority"
      />,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("draws a labelled reference line", () => {
    const { container } = render(
      <BarChart
        data={priorities}
        series={tasksSeries}
        categoryLabel={(key) => NAMES[key]}
        referenceLine={{ value: 3, label: "Avg. 3" }}
        ariaLabel="Tasks by priority"
      />,
    );
    const line = container.querySelector("[data-chart-reference]");
    expect(line).toHaveTextContent("Avg. 3");
  });

  it("formats values and axis ticks", () => {
    const { container } = render(
      <BarChart
        data={[{ key: "a", value: 2.5 }]}
        series={tasksSeries}
        orientation="horizontal"
        valueFormatter={(value) => `${value} pts`}
        categoryLabel={(key) => key}
        ariaLabel="Points"
      />,
    );
    expect(
      container.querySelector("[data-chart-value-label]"),
    ).toHaveTextContent("2.5 pts");
    expect(screen.getByText("0.5 pts")).toBeInTheDocument();
  });

  it("renders nothing without data", () => {
    const { container } = render(
      <BarChart
        data={[]}
        series={tasksSeries}
        categoryLabel={(key) => key}
        ariaLabel="Empty"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
