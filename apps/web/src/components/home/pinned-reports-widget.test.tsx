import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeChartResult } from "@/lib/analytics/test-fixtures";
import type { AnalyticsChartRequest } from "@/types/analytics";
import type { AnalyticsReport } from "@/types/analytics-report";
import PinnedReportsWidget from "./pinned-reports-widget";

const m = vi.hoisted(() => ({
  canRead: true,
  checking: false,
  reports: {} as Record<string, unknown>,
  chart: {} as Record<string, unknown>,
  chartRequests: [] as unknown[],
  pinnedIds: [] as string[],
  toggle: vi.fn(),
  reportsEnabledCalls: 0,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode; to: string }) => (
    <a href={props.to}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canReadAnalytics: () => m.canRead,
    isCheckingPermissions: m.checking,
  }),
}));
vi.mock("@/hooks/queries/analytics-report/use-analytics-reports", () => ({
  useAnalyticsReports: () => {
    m.reportsEnabledCalls += 1;
    return m.reports;
  },
}));
vi.mock("@/hooks/queries/analytics/use-analytics-chart", () => ({
  useAnalyticsChart: (request: AnalyticsChartRequest) => {
    m.chartRequests.push(request);
    return m.chart;
  },
}));
vi.mock("@/hooks/mutations/home/use-toggle-home-report-pin", () => ({
  default: () => ({
    pinnedIds: m.pinnedIds,
    isReady: true,
    toggle: m.toggle,
  }),
}));
vi.mock("@/components/charts/bar-chart", () => ({
  default: ({ data }: { data: unknown[] }) => (
    <div data-testid="bar-chart" data-count={data.length} />
  ),
}));
vi.mock("@/components/analytics/custom-chart-card", () => ({
  useChartNotes: () => [],
}));

function report(overrides: Partial<AnalyticsReport> = {}): AnalyticsReport {
  return {
    id: "r1",
    workspaceId: "ws-1",
    name: "Bugs by priority",
    visibility: "workspace",
    owner: null,
    isOwner: true,
    canDelete: true,
    config: {
      xAxis: "priority",
      scope: { projectIds: ["p1"] },
      metric: "estimatePoints",
    },
    droppedProjectCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as AnalyticsReport;
}

const readyReports = (data: AnalyticsReport[]) => ({
  data,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
});

beforeEach(() => {
  m.canRead = true;
  m.checking = false;
  m.pinnedIds = ["r1"];
  m.reports = readyReports([report()]);
  m.chart = {
    data: makeChartResult(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  m.chartRequests = [];
  m.reportsEnabledCalls = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PinnedReportsWidget", () => {
  it("fetches nothing and renders nothing without analytics:read", () => {
    m.canRead = false;
    const { container } = render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(container).toBeEmptyDOMElement();
    expect(m.reportsEnabledCalls).toBe(0);
  });

  it("charts a pinned report with its saved scope and settings", () => {
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(screen.getByText("Bugs by priority")).toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(m.chartRequests[0]).toMatchObject({
      workspaceId: "ws-1",
      scope: { projectIds: ["p1"] },
      xAxis: "priority",
      metric: "estimatePoints",
    });
  });

  it("ignores a pin it can't see, and says what to do with none left", () => {
    m.pinnedIds = ["deleted-or-private"];
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(screen.queryByTestId("bar-chart")).toBeNull();
    expect(screen.getByText("home:pinnedReports.empty")).toBeInTheDocument();
  });

  it("keeps the pinned order", () => {
    m.pinnedIds = ["r2", "r1"];
    m.reports = readyReports([
      report(),
      report({ id: "r2", name: "Second report" }),
    ]);
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(["Second report", "Bugs by priority"]);
  });

  it("unpins from the card", () => {
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: /home:pinnedReports\.unpin/ }),
    );
    expect(m.toggle).toHaveBeenCalledWith("r1", ["r1"]);
  });

  it("retries a report list that failed to load", () => {
    const refetch = vi.fn();
    m.reports = { isPending: false, isError: true, refetch };
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(
      screen.getByText("home:pinnedReports.loadError"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "analytics:states.retry" }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps one failed chart to its own card", () => {
    m.chart = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    };
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(screen.getByText("Bugs by priority")).toBeInTheDocument();
    expect(
      screen.getByText("home:pinnedReports.chartError"),
    ).toBeInTheDocument();
  });

  it("says when a report's tasks left it empty", () => {
    m.chart = {
      data: makeChartResult({ totalCount: 0 }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    render(<PinnedReportsWidget workspaceId="ws-1" />);
    expect(screen.getByText("analytics:states.noTasks")).toBeInTheDocument();
  });
});
