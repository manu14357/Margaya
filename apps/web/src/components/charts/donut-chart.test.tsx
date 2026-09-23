import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GROUP_CHART_COLORS } from "@/lib/charts/series-colors";
import DonutChart, { type DonutSlice } from "./donut-chart";

vi.setConfig({ testTimeout: 15_000 });

afterEach(() => {
  cleanup();
});

const groups: DonutSlice[] = [
  {
    key: "backlog",
    label: "Backlog",
    value: 1,
    color: GROUP_CHART_COLORS.backlog,
  },
  {
    key: "started",
    label: "Started",
    value: 1,
    color: GROUP_CHART_COLORS.started,
  },
  {
    key: "cancelled",
    label: "Cancelled",
    value: 0,
    color: GROUP_CHART_COLORS.cancelled,
  },
  {
    key: "completed",
    label: "Completed",
    value: 1,
    color: GROUP_CHART_COLORS.completed,
  },
];

function legendRow(key: string) {
  const row = document.querySelector(`[data-chart-legend-row="${key}"]`);
  if (!(row instanceof HTMLElement)) throw new Error(`missing row ${key}`);
  return row;
}

describe("DonutChart", () => {
  it("draws a slice per non-zero value and lists every slice with its share", () => {
    const { container } = render(
      <DonutChart
        slices={groups}
        centerLabel="3 tasks"
        ariaLabel="3 tasks in 4 groups"
      />,
    );
    expect(
      screen.getByRole("img", { name: "3 tasks in 4 groups" }),
    ).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("3 tasks")).toBeInTheDocument();
    const slices = container.querySelectorAll("[data-chart-slice]");
    expect(
      Array.from(slices, (slice) => slice.getAttribute("data-chart-slice")),
    ).toEqual(["backlog", "started", "completed"]);
    expect(slices[2]).toHaveClass("fill-success");

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    // Shares use the largest remainder, so they sum to 100.
    expect(legendRow("backlog")).toHaveTextContent("Backlog134%");
    expect(legendRow("started")).toHaveTextContent("Started133%");
    expect(legendRow("cancelled")).toHaveTextContent("Cancelled00%");
    expect(legendRow("completed")).toHaveTextContent("Completed133%");
  });

  it("moves between slices with the keyboard and highlights the legend row", () => {
    const { container } = render(
      <DonutChart slices={groups} ariaLabel="Tasks by group" />,
    );
    const svg = screen.getByRole("img", { name: "Tasks by group" });
    act(() => svg.focus());
    expect(screen.getByRole("status")).toHaveTextContent("Backlog");
    expect(legendRow("backlog")).toHaveClass("bg-accent");

    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowDown" });
    // The zero slice is skipped: it has nothing to point at.
    const tooltip = screen.getByRole("status");
    expect(tooltip).toHaveTextContent("Completed");
    expect(tooltip).toHaveTextContent("33%");
    expect(legendRow("completed")).toHaveClass("bg-accent");
    expect(legendRow("backlog")).not.toHaveClass("bg-accent");
    // The other slices fade back.
    expect(container.querySelector('[data-chart-slice="backlog"]')).toHaveClass(
      "opacity-40",
    );

    fireEvent.keyDown(svg, { key: "Escape" });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("shows the hovered slice", () => {
    const { container } = render(
      <DonutChart slices={groups} ariaLabel="Tasks by group" />,
    );
    const slice = container.querySelector('[data-chart-slice="started"]');
    if (!slice) throw new Error("missing slice");
    fireEvent.mouseMove(slice);
    expect(screen.getByRole("status")).toHaveTextContent("Started");
    expect(legendRow("started")).toHaveClass("bg-accent");
    // The legend row is the visual readout; nothing floats over the hole.
    expect(container.querySelector('[data-slot="chart-tooltip"]')).toBeNull();
  });

  it("draws an empty ring with the empty text for a zero total", () => {
    const { container } = render(
      <DonutChart
        slices={groups.map((slice) => ({ ...slice, value: 0 }))}
        centerLabel="0 tasks"
        emptyLabel="No tasks yet"
        ariaLabel="No tasks"
      />,
    );
    expect(container.querySelector("[data-chart-empty-ring]")).toHaveClass(
      "stroke-border",
    );
    expect(container.querySelectorAll("[data-chart-slice]")).toHaveLength(0);
    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.queryByText("0 tasks")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("img", { name: "No tasks" })).not.toHaveAttribute(
      "tabindex",
    );
  });

  it("formats values and shares", () => {
    render(
      <DonutChart
        slices={[
          { ...groups[0], value: 1.5 },
          { ...groups[1], value: 0.5 },
        ]}
        valueFormatter={(value) => `${value} pts`}
        percentFormatter={(percent) => `${percent} %`}
        ariaLabel="Points by group"
      />,
    );
    expect(legendRow("backlog")).toHaveTextContent("Backlog1.5 pts75 %");
    expect(legendRow("started")).toHaveTextContent("Started0.5 pts25 %");
  });
});
