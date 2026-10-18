import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ForecastCard from "./forecast-card";

const m = vi.hoisted(() => ({
  query: {} as {
    data?: Record<string, unknown>;
    isPending: boolean;
    isError: boolean;
    refetch: () => void;
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && Object.keys(options).length > 0
        ? `${key}(${Object.entries(options)
            .map(([name, value]) => `${name}=${value}`)
            .join(",")})`
        : key,
  }),
}));
vi.mock("@/hooks/queries/delivery/use-delivery", () => ({
  useForecast: () => m.query,
}));
vi.mock("@/lib/cycle/dates", () => ({
  formatCycleDate: (day: string) => `D:${day}`,
}));
vi.mock("@/lib/format", () => ({
  formatNumber: (value: number) => String(value),
}));

function forecast(overrides: Record<string, unknown> = {}) {
  return {
    scope: { type: "cycle", id: "c1", projectId: "p1", endDate: "2026-10-30" },
    status: "ok",
    reason: null,
    today: "2026-10-21",
    remaining: 10,
    history: {
      from: "2026-08-26",
      to: "2026-10-20",
      days: 56,
      completed: 28,
      activeDays: 20,
      minPerDay: 0,
      maxPerDay: 3,
      perWeek: 3.5,
    },
    p50: { days: 18, date: "2026-11-07" },
    p85: { days: 24, date: "2026-11-13" },
    p95: { days: 29, date: "2026-11-18" },
    probabilityByEnd: 0.12,
    beyondHorizon: false,
    method: {
      name: "monte_carlo_daily_throughput",
      iterations: 10000,
      seed: 42,
      maxDays: 730,
    },
    ...overrides,
  };
}

beforeEach(() => {
  m.query = {
    data: forecast(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});
afterEach(() => cleanup());

const renderCard = () =>
  render(<ForecastCard projectId="p1" scope="cycle" id="c1" />);

describe("ForecastCard", () => {
  it("shows the P85 date, the range and the chance by the end date", () => {
    renderCard();
    expect(
      screen.getByText("delivery:forecast.likelyBy(date=D:2026-11-13)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "delivery:forecast.percentiles(p50=D:2026-11-07,p95=D:2026-11-18)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "delivery:forecast.chanceByEnd(percent=12,date=D:2026-10-30)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("delivery:forecast.open(count=10)"),
    ).toBeInTheDocument();
  });

  it("explains the method and the sample in a popover", async () => {
    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "delivery:forecast.howCalculated" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("delivery:forecast.method.body(iterations=10000)"),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText("delivery:forecast.method.perDay(min=0,max=3)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "delivery:forecast.method.window(from=D:2026-08-26,to=D:2026-10-20)",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("delivery:forecast.method.seed(seed=42)"),
    ).toBeInTheDocument();
  });

  it("is honest about thin history", () => {
    m.query.data = forecast({
      status: "insufficient_history",
      reason: "few_completions",
      p50: null,
      p85: null,
      p95: null,
      probabilityByEnd: null,
    });
    renderCard();
    expect(
      screen.getByText("delivery:forecast.insufficient.few_completions"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/likelyBy/)).toBeNull();
  });

  it("says when everything is done, and when it is beyond the horizon", () => {
    m.query.data = forecast({ status: "complete", remaining: 0 });
    renderCard();
    expect(screen.getByText("delivery:forecast.complete")).toBeInTheDocument();
    cleanup();

    m.query.data = forecast({ p85: null, p95: null, beyondHorizon: true });
    renderCard();
    expect(
      screen.getByText("delivery:forecast.beyondHorizon"),
    ).toBeInTheDocument();
  });

  it("offers a retry when loading fails", () => {
    m.query = {
      data: undefined,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    };
    renderCard();
    fireEvent.click(
      screen.getByRole("button", { name: "delivery:forecast.retry" }),
    );
    expect(m.query.refetch).toHaveBeenCalled();
  });
});
