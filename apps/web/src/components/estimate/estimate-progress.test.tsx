import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disabledEstimateTotals } from "@/lib/estimate/totals";
import type { EstimateTotals } from "@/types/estimate";
import { estimateBurnChartProps, estimateChartOf } from "./estimate-chart";
import EstimateProgressSummary from "./estimate-progress-summary";
import { testTranslate } from "./test-fixtures";

function t(key: string, options: Record<string, unknown> = {}) {
  if (
    key.startsWith("tasks:estimate.totals") ||
    key.includes("chart.summary")
  ) {
    return `${key} ${JSON.stringify(options)}`;
  }
  return testTranslate(key, options);
}

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t }),
}));

afterEach(() => cleanup());

function totals(overrides: Partial<EstimateTotals>): EstimateTotals {
  return {
    ...disabledEstimateTotals(),
    enabled: true,
    estimateId: "estimate-1",
    ...overrides,
  };
}

const group = (
  taskCount: number,
  estimatedTaskCount: number,
  total: number,
) => ({
  taskCount,
  estimatedTaskCount,
  total,
});

const pointTotals = totals({
  type: "points",
  isNumeric: true,
  taskCount: 6,
  estimatedTaskCount: 5,
  completedTaskCount: 2,
  completedEstimatedTaskCount: 2,
  total: 21,
  completed: 8,
  byGroup: {
    backlog: group(1, 1, 3),
    unstarted: group(1, 1, 5),
    started: group(1, 0, 0),
    completed: group(2, 2, 8),
    cancelled: group(1, 1, 5),
  },
});

describe("EstimateProgressSummary", () => {
  it("renders nothing while estimates are off or unknown", () => {
    for (const estimates of [null, undefined, disabledEstimateTotals()]) {
      const { container } = render(
        <EstimateProgressSummary estimates={estimates} />,
      );
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });

  it("shows completed of total points, leaving cancelled work out", () => {
    render(<EstimateProgressSummary estimates={pointTotals} />);
    expect(
      screen.getByText(
        'tasks:estimate.totals.points {"completed":"8","total":"16","count":16}',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'tasks:estimate.totals.estimated {"estimated":4,"total":5}',
      ),
    ).toBeInTheDocument();
  });

  it("formats time totals as durations", () => {
    render(
      <EstimateProgressSummary
        estimates={totals({
          type: "time",
          isNumeric: true,
          taskCount: 2,
          estimatedTaskCount: 2,
          total: 150,
          completed: 60,
          byGroup: {
            ...disabledEstimateTotals().byGroup,
            cancelled: group(0, 0, 0),
          },
        })}
      />,
    );
    expect(
      screen.getByText(
        'tasks:estimate.totals.time {"completed":"1h","total":"2h 30m"}',
      ),
    ).toBeInTheDocument();
  });

  it("shows how many tasks sit on each category", () => {
    render(
      <EstimateProgressSummary
        estimates={totals({
          type: "categories",
          isNumeric: false,
          taskCount: 3,
          estimatedTaskCount: 3,
          distribution: [
            {
              pointId: "s",
              value: "S",
              position: 1,
              taskCount: 2,
              completedTaskCount: 0,
            },
            {
              pointId: "m",
              value: "M",
              position: 2,
              taskCount: 0,
              completedTaskCount: 0,
            },
            {
              pointId: "l",
              value: "L",
              position: 3,
              taskCount: 1,
              completedTaskCount: 1,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.queryByText("M")).toBeNull();
    expect(screen.queryByText(/tasks:estimate\.totals\.points/)).toBeNull();
  });
});

const chart = {
  scope: 13,
  days: [
    { date: "2026-09-01", remaining: 13, completed: 0, ideal: 13 },
    { date: "2026-09-02", remaining: 8, completed: 5, ideal: 6.5 },
    { date: "2026-09-03", remaining: null, completed: null, ideal: 0 },
  ],
};

describe("estimate charts", () => {
  it("offers the estimate chart only for an active numeric system", () => {
    expect(
      estimateChartOf({ estimates: pointTotals, estimateChart: chart }),
    ).toEqual({ chart, type: "points" });
    expect(
      estimateChartOf({ estimates: pointTotals, estimateChart: null }),
    ).toBeNull();
    expect(
      estimateChartOf({
        estimates: totals({ type: "categories", isNumeric: false }),
        estimateChart: chart,
      }),
    ).toBeNull();
    expect(
      estimateChartOf({
        estimates: disabledEstimateTotals(),
        estimateChart: chart,
      }),
    ).toBeNull();
  });

  it("labels the burndown in points and summarizes what is left", () => {
    const props = estimateBurnChartProps({
      progress: { estimates: pointTotals, estimateChart: chart },
      mode: "burndown",
      daysLeft: 1,
      labels: { ideal: "Ideal", completed: "Completed", scope: "Scope" },
      t,
    });
    expect(props?.labels).toEqual({
      actual: "tasks:estimate.chart.pointsLeft",
      reference: "Ideal",
    });
    expect(props?.ariaLabel).toBe(
      'tasks:estimate.chart.summaryPoints {"remaining":"8","scope":"13","days":1}',
    );
    expect(props?.formatValue(2.5)).toBe("2.5");
  });

  it("formats time charts as durations", () => {
    const props = estimateBurnChartProps({
      progress: {
        estimates: totals({ type: "time", isNumeric: true }),
        estimateChart: { ...chart, scope: 90 },
      },
      mode: "burnup",
      daysLeft: 0,
      labels: { ideal: "Ideal", completed: "Completed", scope: "Scope" },
      t,
    });
    expect(props?.labels).toEqual({ actual: "Completed", reference: "Scope" });
    expect(props?.formatValue(90)).toBe("1h 30m");
  });
});
